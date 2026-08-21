import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { freezeSchedule } from "../commissions";
import { DomainError, ProviderNotConfiguredError } from "../errors";
import { uuidv7 } from "../ids";
import { money, type Money } from "../money";
import { logger } from "../observability";
import type {
  ChargeResult, HeadersLike, PaymentProvider, VerifiedChargeEvent, VerifiedEvent,
} from "../payments";
import { stageOfTransportFailure } from "../payments";
import { parsePaymentChannel, type PaymentChannel } from "../payments";
import { loadBuyerProfile, requireCompleteProfile } from "../profile";
import { applyRefundEvent, recordRefundOwed } from "../refunds";
import { loadLatePaymentGraceSeconds, OrderNotFoundError } from "./checkout";
import {
  assertPaymentTransition, orderStateForPayment,
  type OrderState, type PaymentState,
} from "./state";

/**
 * The payment boundary.
 *
 * Two things happen in this file and it is worth being explicit about which is
 * which, because the milestone brief asks for exactly this distinction:
 *
 *   PAYMENT CONFIRMED — a provider event, verified against the raw bytes we
 *   received and then cross-checked against our own order, says a charge
 *   succeeded. That moves the payment and the order, freezes the commission
 *   split, and grants the buyer's entitlement.
 *
 *   FINANCIAL SETTLEMENT — ledger postings that turn a captured payment into a
 *   seller's claim on money. NOT performed here, and deliberately not by a mock.
 *   The ledger is append-only, so a posting made on a simulated capture can
 *   never be removed; and a seller entitlement created before Afrinext actually
 *   holds the funds is a promise the balance cannot keep.
 *
 * What confirmation does write is the FROZEN FEE SCHEDULE, which is the sale's
 * economics — gross, platform commission, seller share — resolved from the
 * rules in force at that moment and made permanent. It moves no money. When
 * settlement is built it reads that schedule rather than re-resolving rules
 * that may have changed in the meantime.
 */

const log = logger.child({ component: "orders.payment" });

export class PaymentNotFoundError extends DomainError {
  override readonly name = "PaymentNotFoundError";
  constructor(ref: string) {
    super("order.payment_not_found", `No payment matches "${ref}".`);
  }
}

export class OrderNotPayableError extends DomainError {
  override readonly name = "OrderNotPayableError";
  constructor(why: string) {
    super("order.not_payable", why);
  }
}

export class WebhookRejectedError extends DomainError {
  override readonly name = "WebhookRejectedError";
  constructor(why: string) {
    super("payment.webhook_rejected", why);
  }
}

export interface PaymentRecord {
  readonly id: string;
  readonly orderId: string;
  readonly provider: string;
  readonly providerRef: string | null;
  readonly status: PaymentState;
  readonly amount: Money;
  readonly redirectUrl?: string | undefined;
}

interface PaymentRow {
  [key: string]: unknown;
  id: string;
  order_id: string;
  provider: string;
  provider_ref: string | null;
  status: string;
  amount_minor: string | bigint;
  currency: string;
}

function toPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    providerRef: row.provider_ref,
    status: row.status as PaymentState,
    amount: money(BigInt(row.amount_minor), row.currency),
  };
}

export interface InitiatePaymentInput {
  readonly orderId: string;
  /** Where the provider should send the buyer back to, when it hosts the flow. */
  readonly returnUrl?: string | undefined;
  /**
   * How the buyer pays. REQUIRED, and typed as the allowlist.
   *
   * Required rather than optional so a caller that forgets it fails to compile
   * instead of silently producing a charge with no channel. There is no
   * default: iPayMoney documents none for `Ipay-Payment-Type`, and picking one
   * on a buyer's behalf is a decision about their money.
   *
   * Typed as `PaymentChannel` so the provider's own vocabulary cannot travel
   * here. `parsePaymentChannel` is what turns an untrusted string — a form
   * field, a JSON body — into this type, and it refuses everything else.
   */
  readonly channel: PaymentChannel;
}

/**
 * The buyer facts a charge carries, built from the identity and NOTHING else.
 *
 * Pulled out of `initiatePayment` so it can be called directly with an
 * incomplete identity. That is not a convenience: the profile gate means
 * `initiatePayment` can never reach this with a missing name, so a fallback
 * quietly added here would be unreachable through the front door and no test
 * driving the real path could ever notice it. Mutation testing proved exactly
 * that — three mutants that substituted `display_name`, the phone string and a
 * phone-prefix country all survived a green suite.
 *
 * So the rules are asserted against this function, where the absent cases are
 * reachable:
 *
 *   - a missing name produces NO `customerName` key. It is never replaced by
 *     `display_name` (the synthetic signup address), by Better Auth's `name`
 *     (the phone string), or by anything derived from a number.
 *   - a missing country produces NO country key. It is never inferred from the
 *     phone's calling code and never taken from the store.
 *
 * `country` carries the buyer's country and `buyerCountry` says so
 * unambiguously; see the K17 note in the assumptions register.
 */
export function chargeMetadataFor(buyer: BuyerPaymentIdentity): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (buyer.fullName !== undefined) metadata["customerName"] = buyer.fullName;
  if (buyer.countryCode !== undefined) {
    metadata["buyerCountry"] = buyer.countryCode;
    metadata["country"] = buyer.countryCode;
  }
  return metadata;
}

/**
 * Whether a throw from `createCharge` proves that no charge exists.
 *
 * Only two shapes qualify, and the distinction is the Phase 3 rule one layer
 * up: UNKNOWN MUST NEVER BECOME FAILED.
 *
 *   ProviderNotConfiguredError  the adapter refused. Either it declined to
 *                               build a request at all — a missing buyer
 *                               field, missing credentials, an unsupported
 *                               currency — or the provider answered with a
 *                               documented refusal that states no payment was
 *                               created. The adapter owns that classification
 *                               and this layer honours it rather than
 *                               re-deciding it from an HTTP status.
 *
 *   stage "not_transmitted"     the bytes provably never left this process:
 *                               DNS, connection refused, an unreachable host.
 *
 * Everything else — a timeout, a reset, an HTTP 5xx, an unparseable answer — is
 * a charge that MAY exist under our idempotency key, and saying otherwise would
 * be an assertion about money that nobody can support.
 */
function chargeProvablyNotCreated(error: unknown): boolean {
  if (error instanceof ProviderNotConfiguredError) return true;
  return stageOfTransportFailure(error) === "not_transmitted";
}

/**
 * The buyer details a provider may need, read from OUR records.
 *
 * Every field here is sourced server-side from the buyer's own account. None of
 * it is accepted from the client, for the same reason the amount is not: a
 * field a caller can set is a field a caller can change. A buyer must not be
 * able to tell the provider that somebody else's name, number or country is
 * paying. `InitiatePaymentInput` carries no such field, so there is nothing to
 * override — the values below have exactly one source each.
 *
 * The phone lives in Better Auth's `user` table because that is where sign-in
 * verified it, and `users.auth_user_id` is the link. Using the VERIFIED number
 * matters — it is the one that answered an OTP, not one somebody typed into a
 * form.
 *
 * The name and country come from `users`, where the person put them. Neither
 * `users.display_name` nor Better Auth's `name` is ever read: those hold a
 * synthetic address and the phone string, and sending either to a payment
 * provider would be inventing a value for a required field.
 */
export interface BuyerPaymentIdentity {
  /** The verified sign-in number, absent for an account created another way. */
  readonly phone: string | undefined;
  /** `users.full_name` — what the buyer typed, and nothing derived. */
  readonly fullName: string | undefined;
  /** `users.country_code` — what the buyer chose, never inferred. */
  readonly countryCode: string | undefined;
}

export async function loadBuyerPaymentIdentity(
  db: Database,
  userId: string,
): Promise<BuyerPaymentIdentity> {
  const rows = await db.execute<{
    [key: string]: unknown;
    phone: string | null;
  }>(sql`
    select a."phoneNumber" as phone
      from users u
      left join "user" a on a.id = u.auth_user_id
     where u.id = ${userId}::uuid
  `);
  const profile = await loadBuyerProfile(db, userId);
  return {
    phone: rows.rows[0]?.phone ?? undefined,
    fullName: profile.fullName,
    countryCode: profile.countryCode,
  };
}

/**
 * Starts a charge for an order.
 *
 * The amount handed to the provider is read from the order row inside this
 * function. There is no amount parameter, so no caller — route handler, server
 * action, test — is in a position to send a different one.
 */
export async function initiatePayment(
  db: Database,
  actor: Actor,
  provider: PaymentProvider,
  input: InitiatePaymentInput,
): Promise<PaymentRecord> {
  await authorize(db, actor, "order.create");

  // Scoped to the buyer in SQL. Someone else's order id resolves to nothing.
  const orders = await db.execute<{
    [key: string]: unknown;
    id: string;
    status: string;
    total_minor: string | bigint;
    currency: string;
    expired: boolean;
  }>(sql`
    select id, status, total_minor, currency, (expires_at <= now()) as expired
      from orders
     where id = ${input.orderId}::uuid and buyer_user_id = ${actor.userId}::uuid
  `);
  const order = orders.rows[0];
  if (order === undefined) throw new OrderNotFoundError(input.orderId);
  if (order.status !== "pending_payment") {
    throw new OrderNotPayableError(`This order is ${order.status} and cannot be paid.`);
  }
  if (order.expired) {
    // Mark it, then refuse. An order past its expiry is not payable even if a
    // sweeper has not run yet — the clock decides, not the sweeper.
    await expireOrder(db, order.id);
    throw new OrderNotPayableError("This checkout has expired. Start a new one.");
  }

  /*
   * One live attempt per order.
   *
   * A partial unique index refuses a second `initiated`/`pending` row, so this
   * read-then-return is not the guarantee — it is the courteous path. Two
   * concurrent initiations resolve to one charge because the database says so.
   */
  const existing = await db.execute<PaymentRow>(sql`
    select id, order_id, provider, provider_ref, status, amount_minor, currency
      from payments where order_id = ${order.id}::uuid and status in ('initiated','pending')
  `);
  const live = existing.rows[0];
  if (live !== undefined) return toPayment(live);

  /*
   * The profile gate, and its position is the point.
   *
   * This runs BEFORE the payment row is written and therefore before any
   * provider call could be built, so an incomplete profile costs nothing: no
   * row to clean up, no charge that might exist, nothing for
   * `payments_one_live_per_order` to wedge. The buyer completes their profile
   * and pays the same order.
   *
   * It runs AFTER the order checks so the more specific truth wins: an order
   * that is already paid, or expired, says so rather than sending the buyer to
   * fill in a form that would not have helped.
   */
  /*
   * The channel, checked again here rather than trusted from the type.
   *
   * TypeScript stops a mistake at compile time; this stops one that arrives at
   * runtime through a JSON body, a form post, or a caller compiled against an
   * older shape. It runs BEFORE the payment row is written, so an unsupported
   * channel leaves nothing behind and constructs no provider request.
   */
  const channel = parsePaymentChannel(input.channel);

  await requireCompleteProfile(db, actor.userId);

  const buyer = await loadBuyerPaymentIdentity(db, actor.userId);
  const amount = money(BigInt(order.total_minor), order.currency);
  const paymentId = uuidv7();
  /*
   * The idempotency key is derived, not supplied.
   *
   * It identifies "the charge for this order", so a retried initiation reaches
   * the provider as the same request rather than a second charge against the
   * same buyer.
   */
  const idempotencyKey = `order:${order.id}:charge`;

  await db.execute(sql`
    insert into payments (id, order_id, provider, status, amount_minor, currency, idempotency_key)
    values (${paymentId}, ${order.id}, ${provider.id}, 'initiated',
            ${order.total_minor.toString()}, ${order.currency}, ${idempotencyKey})
    on conflict (idempotency_key) do nothing
  `);

  const stored = await db.execute<PaymentRow>(sql`
    select id, order_id, provider, provider_ref, status, amount_minor, currency
      from payments where idempotency_key = ${idempotencyKey}
  `);
  const row = stored.rows[0];
  if (row === undefined) throw new PaymentNotFoundError(idempotencyKey);
  if (row.status !== "initiated") return toPayment(row);

  /*
   * The buyer's own details, read from our records rather than taken from the
   * caller. See `loadBuyerPaymentIdentity`.
   *
   * `country` carries the BUYER's country, and that choice is provisional.
   * iPayMoney documents the field only as "le code du pays de la transaction"
   * and does not say whose country that is — question K17. `buyerCountry` says
   * unambiguously what the value actually is, so when K17 is answered the fix
   * is to change which of our facts fills `country`, not to work out what the
   * value ever meant. Both are absent when we hold no country.
   *
   * `customerName` is the name the buyer typed into their own profile. It is
   * read from `users.full_name` and from nowhere else — never from
   * `display_name`, never from Better Auth's `name`, and never assembled from a
   * phone number. The gate above guarantees it is present by the time this
   * runs, so the absence branch is a belt on top of that rather than a path
   * anybody reaches.
   */
  const metadata = chargeMetadataFor(buyer);

  let charge: ChargeResult;
  try {
    charge = await provider.createCharge({
      reference: `order-${order.id}`,
      amount,
      customer: {
        userId: actor.userId,
        ...(buyer.phone !== undefined ? { phone: buyer.phone } : {}),
      },
      idempotencyKey,
      ...(input.returnUrl !== undefined ? { returnUrl: input.returnUrl } : {}),
      channel,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  } catch (error: unknown) {
    /*
     * A throw is not a failed charge, and only one kind of throw may be treated
     * as one.
     *
     * This is the Phase 3 rule — UNKNOWN MUST NEVER BECOME FAILED — applied to
     * charges. `stageOfTransportFailure` owns the table: a provider that
     * refused to build a request at all (a missing buyer field, missing
     * credentials, an unsupported currency), or a failure that provably never
     * left this process (DNS, connection refused), is `not_transmitted`. Only
     * those close the payment.
     *
     * Anything else — a timeout, a reset, an HTTP 5xx — means the charge may
     * exist at the provider under our idempotency key. Closing it would be us
     * asserting that no money moved, which we cannot know. Those leave the row
     * `initiated` and the truth undecided, and the error is rethrown either
     * way.
     *
     * Closing the not-transmitted case is what keeps a refusal from bricking
     * the order: `payments_one_live_per_order` means a row stuck at `initiated`
     * makes every later attempt return that row instead of calling the
     * provider, so the buyer would click pay forever and nothing would happen.
     */
    if (chargeProvablyNotCreated(error)) {
      assertPaymentTransition("initiated", "failed");
      await db.execute(sql`
        update payments set status = 'failed', updated_at = now()
         where id = ${row.id}::uuid and status = 'initiated'
      `);
      await closeOrder(db, order.id, "failed");
      await audit(db, {
        actorKind: "user",
        actorUserId: actor.userId,
        action: "order.payment.refused",
        targetType: "payment",
        targetId: row.id,
        context: {
          orderId: order.id,
          provider: provider.id,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      log.warn("charge refused before transmission", {
        orderId: order.id, provider: provider.id,
      });
    } else {
      log.warn("charge outcome unknown, payment left open", {
        orderId: order.id, provider: provider.id,
      });
    }
    throw error;
  }

  /*
   * The provider's first answer is recorded, but it does not confirm anything.
   *
   * Even when a provider replies "succeeded" synchronously, that is a claim
   * arriving on the same connection the caller controls in a hosted-redirect
   * flow. Confirmation goes through `applyProviderEvent`, which verifies a
   * signature over raw bytes. Here the status is clamped to `pending` for
   * anything that is not a definite refusal.
   */
  const recordedStatus: PaymentState =
    charge.status === "failed" ? "failed"
    : charge.status === "cancelled" ? "cancelled"
    : charge.status === "expired" ? "expired"
    : "pending";

  assertPaymentTransition("initiated", recordedStatus);

  await db.execute(sql`
    update payments
       set provider_ref = ${charge.providerRef}, status = ${recordedStatus}, updated_at = now()
     where id = ${row.id}::uuid and status = 'initiated'
  `);

  // A refusal at initiation closes the order immediately: there is nothing in
  // flight to wait for.
  const orderState = orderStateForPayment(recordedStatus);
  if (orderState !== undefined) await closeOrder(db, order.id, orderState);

  await audit(db, {
    actorKind: "user",
    actorUserId: actor.userId,
    action: "order.payment.initiated",
    targetType: "payment",
    targetId: row.id,
    context: {
      orderId: order.id, provider: provider.id,
      providerRef: charge.providerRef, status: recordedStatus,
    },
  });

  return {
    ...toPayment(row),
    providerRef: charge.providerRef,
    status: recordedStatus,
    ...(charge.redirectUrl !== undefined ? { redirectUrl: charge.redirectUrl } : {}),
  };
}

async function closeOrder(db: Database, orderId: string, to: OrderState): Promise<boolean> {
  const paid = to === "paid";
  const result = await db.execute(sql`
    update orders
       set status = ${to},
           paid_at = case when ${paid} then now() else paid_at end,
           closed_at = now(),
           updated_at = now()
     where id = ${orderId}::uuid and status = 'pending_payment'
  `);
  return (result.rowCount ?? 0) > 0;
}

/** Marks a lapsed checkout expired. Idempotent, and never touches a paid one. */
export async function expireOrder(db: Database, orderId: string): Promise<boolean> {
  const result = await db.execute(sql`
    update orders set status = 'expired', closed_at = now(), updated_at = now()
     where id = ${orderId}::uuid and status = 'pending_payment' and expires_at <= now()
  `);
  return (result.rowCount ?? 0) > 0;
}

/** Sweeps every lapsed checkout. Safe to run repeatedly and concurrently. */
export async function expireLapsedOrders(db: Database): Promise<number> {
  const result = await db.execute(sql`
    update orders set status = 'expired', closed_at = now(), updated_at = now()
     where status = 'pending_payment' and expires_at <= now()
  `);
  return result.rowCount ?? 0;
}

export type EventOutcome = "applied" | "ignored" | "rejected";

export interface AppliedEvent {
  readonly outcome: EventOutcome;
  readonly reason?: string | undefined;
  readonly paymentId?: string | undefined;
  readonly orderId?: string | undefined;
  readonly orderStatus?: OrderState | undefined;
}

/**
 * The server-side verification boundary. Everything a real provider must do.
 *
 * The browser is never believed. A buyer returning from a hosted checkout page
 * with "success" in the URL proves only that they can type a URL. What is
 * believed is a signed event, and only after five separate checks:
 *
 *   1. the signature verifies over the RAW bytes, before any parsing;
 *   2. the provider's event id has not been seen before (unique index);
 *   3. the provider reference resolves to a payment we created;
 *   4. the amount matches the payment exactly — minor units and currency;
 *   5. the transition is legal from the state the payment is actually in.
 *
 * A failure at 3, 4 or 5 is recorded as a REJECTED event and changes nothing.
 * The record matters: a forged amount arriving at this endpoint leaves a row.
 */
export async function applyProviderEvent(
  db: Database,
  provider: PaymentProvider,
  rawBody: Buffer,
  headers: HeadersLike,
  /**
   * When the event is being processed. Defaults to now, and exists so the grace
   * boundary can be tested at the exact millisecond rather than approximately —
   * "24 hours and one millisecond" is a rule, and a rule nobody can test at its
   * edge is a rule nobody has checked.
   */
  now: number = Date.now(),
): Promise<AppliedEvent> {
  let event: VerifiedEvent;
  try {
    // Step 1. Parsing before verifying is how signature checks get bypassed,
    // so the raw bytes go in and nothing is trusted until this returns.
    event = await provider.verifyWebhook(rawBody, headers);
  } catch (error: unknown) {
    log.warn("webhook signature refused", { provider: provider.id, cause: String(error) });
    throw new WebhookRejectedError("The event signature does not verify.");
  }

  /*
   * A refund event is a different fact about a different object.
   *
   * The signature check above is shared — a refund webhook is not a second,
   * weaker door — but everything after it is not: a refund event names a refund
   * reference, not a charge, and moves the refund machine rather than the
   * payment one. Routing here rather than letting the charge path try to make
   * sense of it is what keeps "which object is this about?" from being a
   * question answered by whichever field happened to be populated.
   */
  if (event.subject === "refund") {
    const refundOutcome = await applyRefundEvent(
      db,
      {
        providerRefundRef: event.providerRefundRef,
        ...(event.providerRef !== undefined ? { providerRef: event.providerRef } : {}),
        status: event.status,
        ...(event.notExecutedEvidence !== undefined
          ? { notExecutedEvidence: event.notExecutedEvidence }
          : {}),
        raw: event.raw,
        ...(event.amount !== undefined
          ? { amount: { amountMinor: event.amount.amountMinor, currency: event.amount.currency } }
          : {}),
      },
      provider.id,
    );

    // Recorded in the same table and under the same replay index charges use.
    await db.execute(sql`
      insert into payment_events (id, payment_id, provider, provider_event_id, provider_ref,
                                  type, reported_status, outcome, reason, payload,
                                  subject, refund_id)
      values (${uuidv7()}, null, ${provider.id}, ${event.providerEventId},
              ${event.providerRefundRef}, ${event.type}, ${event.status},
              ${refundOutcome.resolved ? "applied" : refundOutcome.matched ? "ignored" : "rejected"},
              ${refundOutcome.reason}, ${rawBody.toString("utf8").slice(0, 8000)},
              'refund', ${refundOutcome.matched ? refundOutcome.refundId : null})
      on conflict (provider, provider_event_id) do nothing
    `);

    if (!refundOutcome.matched) {
      log.warn("refund webhook for an unknown refund", {
        providerRefundRef: event.providerRefundRef,
      });
      throw new WebhookRejectedError("That refund is not known here.");
    }
    return {
      outcome: refundOutcome.resolved ? "applied" : "ignored",
      reason: refundOutcome.reason,
    };
  }

  const chargeEvent: VerifiedChargeEvent = event;

  const payments = await db.execute<PaymentRow & { order_status: string; buyer_user_id: string; store_id: string }>(sql`
    select p.id, p.order_id, p.provider, p.provider_ref, p.status, p.amount_minor, p.currency,
           o.status as order_status, o.buyer_user_id, o.store_id
      from payments p join orders o on o.id = p.order_id
     where p.provider = ${provider.id} and p.provider_ref = ${chargeEvent.providerRef}
  `);
  const payment = payments.rows[0];

  const record = async (
    outcome: EventOutcome,
    reason: string | undefined,
  ): Promise<boolean> => {
    // Step 2. `on conflict do nothing` on (provider, provider_event_id): a
    // replayed event writes nothing and, because this returns false, applies
    // nothing either.
    const inserted = await db.execute(sql`
      insert into payment_events (id, payment_id, provider, provider_event_id, provider_ref,
                                  type, reported_status, outcome, reason, payload)
      values (${uuidv7()}, ${payment?.id ?? null}, ${provider.id}, ${chargeEvent.providerEventId},
              ${chargeEvent.providerRef}, ${chargeEvent.type}, ${chargeEvent.status}, ${outcome},
              ${reason ?? null}, ${rawBody.toString("utf8").slice(0, 8000)})
      on conflict (provider, provider_event_id) do nothing
    `);
    return (inserted.rowCount ?? 0) > 0;
  };

  // Step 3.
  if (payment === undefined) {
    await record("rejected", "no payment matches the provider reference");
    log.warn("webhook for an unknown charge", { providerRef: chargeEvent.providerRef });
    throw new WebhookRejectedError("That charge is not known here.");
  }

  // Step 4. Exact equality on both fields. A near-miss is a mismatch.
  if (chargeEvent.amount !== undefined) {
    const sameAmount = chargeEvent.amount.amountMinor === BigInt(payment.amount_minor);
    const sameCurrency = chargeEvent.amount.currency === payment.currency;
    if (!sameAmount || !sameCurrency) {
      const fresh = await record(
        "rejected",
        `amount mismatch: event ${chargeEvent.amount.amountMinor}${chargeEvent.amount.currency}, ` +
          `payment ${String(payment.amount_minor)}${payment.currency}`,
      );
      log.warn("webhook amount does not match the order", {
        paymentId: payment.id, providerRef: chargeEvent.providerRef, replay: !fresh,
      });
      await audit(db, {
        actorKind: "system",
        action: "order.payment.event_rejected",
        targetType: "payment",
        targetId: payment.id,
        context: { reason: "amount_mismatch", providerEventId: chargeEvent.providerEventId },
      });
      throw new WebhookRejectedError("The event does not match this charge.");
    }
  }

  const from = payment.status as PaymentState;
  const to = chargeEvent.status as PaymentState;

  // An event that repeats the state we are already in, or that arrives after a
  // terminal one, is old news rather than an attack: recorded, then ignored.
  if (from === to || (orderStateForPayment(from) !== undefined && from !== "pending")) {
    await record("ignored", `stale event: payment is already ${from}`);
    return {
      outcome: "ignored",
      reason: "stale",
      paymentId: payment.id,
      orderId: payment.order_id,
      orderStatus: payment.order_status as OrderState,
    };
  }

  // Step 5.
  try {
    assertPaymentTransition(from, to);
  } catch {
    await record("rejected", `illegal transition ${from} → ${to}`);
    throw new WebhookRejectedError("That transition is not possible for this charge.");
  }

  const applied = await confirm(db, rawBody, {
    providerId: provider.id,
    event: chargeEvent,
    paymentId: payment.id,
    orderId: payment.order_id,
    orderStatus: payment.order_status as OrderState,
    from,
    to,
    now,
  });

  if (applied.outcome === "applied") {
    await audit(db, {
      actorKind: "system",
      action:
        applied.orderStatus === "refund_due"
          ? "order.payment.refund_due"
          : applied.reason === "late_accepted"
            ? "order.payment.late_accepted"
            : "order.payment.confirmed",
      targetType: "order",
      targetId: payment.order_id,
      context: {
        paymentId: payment.id,
        providerEventId: chargeEvent.providerEventId,
        paymentStatus: to,
        orderStatus: applied.orderStatus,
        // Why a late payment was or was not fulfilled, in the record that
        // outlives the incident.
        ...(applied.reason !== undefined ? { decision: applied.reason } : {}),
      },
    });
  }

  return applied;
}

/**
 * Everything a confirmation changes, in ONE transaction.
 *
 * The order inside matters. The guarded UPDATE comes first and is what makes
 * this idempotent: it names the state it expects, so a second delivery — a
 * replay, a concurrent one, a provider retrying after our 500 — matches no rows
 * and applies nothing. The event row is written LAST, carrying what actually
 * happened rather than what we hoped would happen when we started.
 *
 * Everything being in one transaction is also what stops a half-confirmed sale.
 * If freezing the economics fails — no commission rule in force, say — the
 * whole thing rolls back: the order stays payable, no event is recorded as
 * applied, and the provider's retry finds a clean slate to work with. The
 * alternative, committing the status and repairing the rest afterwards, leaves
 * a paid order with no record of what it charged, and a retry that refuses to
 * touch it because the event id has been seen.
 */
async function confirm(
  db: Database,
  rawBody: Buffer,
  input: {
    providerId: string;
    event: VerifiedChargeEvent;
    paymentId: string;
    orderId: string;
    orderStatus: OrderState;
    from: PaymentState;
    to: PaymentState;
    now: number;
  },
): Promise<AppliedEvent> {
  const graceSeconds = await loadLatePaymentGraceSeconds(db);

  return db.transaction(async (tx) => {
    const recordIn = async (outcome: EventOutcome, reason: string | undefined): Promise<void> => {
      await tx.execute(sql`
        insert into payment_events (id, payment_id, provider, provider_event_id, provider_ref,
                                    type, reported_status, outcome, reason, payload)
        values (${uuidv7()}, ${input.paymentId}, ${input.providerId}, ${input.event.providerEventId},
                ${input.event.providerRef}, ${input.event.type}, ${input.event.status},
                ${outcome}, ${reason ?? null}, ${rawBody.toString("utf8").slice(0, 8000)})
        on conflict (provider, provider_event_id) do nothing
      `);
    };

    /*
     * The order row is LOCKED before anything is decided.
     *
     * A confirmation and the expiry sweeper race for the same row, and the
     * answer must not depend on who reads first. `for update` makes them queue:
     * whichever arrives second sees the state the first one committed, and
     * takes the branch that state deserves. Without it, both could read
     * `pending_payment`, and the sweeper could expire an order that had just
     * been paid.
     */
    const locked = await tx.execute<{
      [key: string]: unknown;
      status: string;
      buyer_user_id: string;
      within_grace: boolean;
    }>(sql`
      select status, buyer_user_id,
             (${new Date(input.now).toISOString()}::timestamptz
                <= expires_at + make_interval(secs => ${graceSeconds})) as within_grace
        from orders where id = ${input.orderId}::uuid
        for update
    `);
    const order = locked.rows[0];
    if (order === undefined) {
      await recordIn("rejected", "the order disappeared");
      throw new WebhookRejectedError("That charge is not known here.");
    }

    const paymentMoved = await tx.execute(sql`
      update payments
         set status = ${input.to},
             confirmed_at = case when ${input.to === "succeeded"} then now() else confirmed_at end,
             updated_at = now()
       where id = ${input.paymentId}::uuid and status = ${input.from}
    `);
    if ((paymentMoved.rowCount ?? 0) === 0) {
      await recordIn("ignored", `the payment was no longer ${input.from}`);
      return {
        outcome: "ignored" as const,
        reason: "replay",
        paymentId: input.paymentId,
        orderId: input.orderId,
        orderStatus: order.status as OrderState,
      };
    }

    const from = order.status as OrderState;
    let reached = from;
    let note: string | undefined;

    if (from === "pending_payment") {
      // The ordinary path, unchanged: whatever the payment became, the order
      // follows it.
      const orderState = orderStateForPayment(input.to);
      if (orderState !== undefined) {
        const moved = await tx.execute(sql`
          update orders
             set status = ${orderState},
                 paid_at = case when ${orderState === "paid"} then now() else paid_at end,
                 closed_at = now(),
                 updated_at = now()
           where id = ${input.orderId}::uuid and status = 'pending_payment'
        `);
        if ((moved.rowCount ?? 0) > 0) {
          reached = orderState;
          if (orderState === "paid") await fulfil(tx, input.orderId);
        }
      }
    } else if (from === "expired" && input.to === "succeeded") {
      /*
       * Money arrived after we stopped waiting.
       *
       * It is real whatever our timer did, so it cannot be ignored — the only
       * question is whether fulfilling is still safe. Four conditions, all
       * checked here, all in SQL against the current state rather than against
       * anything the event claimed:
       *
       *   - the payment is inside the grace window;
       *   - the product is still published;
       *   - its store is still published;
       *   - the buyer does not already own the product.
       *
       * The last is the one that protects the buyer's money: if they gave up,
       * bought again and were fulfilled, granting a second time would silently
       * consume a second payment for one thing they own. It becomes a refund
       * instead.
       */
      const blocking = await tx.execute<{ [key: string]: unknown; reason: string }>(sql`
        select 'product_unpublished' as reason
          from order_items i join products p on p.id = i.product_id
         where i.order_id = ${input.orderId}::uuid and p.status <> 'published'
        union all
        select 'store_unpublished'
          from order_items i join products p on p.id = i.product_id
               join stores s on s.id = p.store_id
         where i.order_id = ${input.orderId}::uuid and s.status <> 'published'
        union all
        select 'already_owned'
          from order_items i
               join entitlements e on e.product_id = i.product_id
         where i.order_id = ${input.orderId}::uuid
           and e.user_id = ${order.buyer_user_id}::uuid
           and e.revoked_at is null
      `);

      const reasons = blocking.rows.map((r) => r.reason);
      if (!order.within_grace) reasons.unshift("grace_window_elapsed");

      if (reasons.length === 0) {
        const moved = await tx.execute(sql`
          update orders
             set status = 'paid', paid_at = now(), late_payment_at = now(),
                 closed_at = now(), updated_at = now()
           where id = ${input.orderId}::uuid and status = 'expired'
        `);
        if ((moved.rowCount ?? 0) > 0) {
          reached = "paid";
          note = "late_accepted";
          await fulfil(tx, input.orderId);
        }
      } else {
        /*
         * Not fulfilled, and not silent. `refund_due` is a queue: the payment
         * succeeded, Afrinext did not deliver, and a refund must later be
         * executed through the provider. Nothing here executes one.
         */
        const moved = await tx.execute(sql`
          update orders
             set status = 'refund_due', late_payment_at = now(),
                 closed_at = now(), updated_at = now()
           where id = ${input.orderId}::uuid and status = 'expired'
        `);
        if ((moved.rowCount ?? 0) > 0) {
          reached = "refund_due";
          note = reasons.join(",");
          /*
           * The debt is recorded HERE, inside the same transaction.
           *
           * Phase 2 left `refund_due` as a status somebody would have to
           * remember to query. That is a debt that exists only as an
           * inference, and an inference is exactly what gets lost when a
           * sweeper is not written or a query is filtered wrongly. Creating
           * the row in the transaction that creates the obligation means the
           * two cannot disagree: either both happened or neither did.
           *
           * It records only. Nothing here contacts a provider, and no money
           * moves until a finance user says so — see refunds/execute.ts.
           */
          await recordRefundOwed(tx, {
            orderId: input.orderId,
            paymentId: input.paymentId,
            reason: note,
          });
        }
      }
    }

    await recordIn("applied", note);
    return {
      outcome: "applied" as const,
      paymentId: input.paymentId,
      orderId: input.orderId,
      orderStatus: reached,
      ...(note !== undefined ? { reason: note } : {}),
    };
  });
}

/**
 * What being paid grants: the entitlement, then the frozen economics.
 *
 * One function, called from both the ordinary path and the late one, so a
 * late-accepted order is fulfilled by exactly the same code as an on-time one.
 * Two paths that both "grant access and freeze fees" would eventually stop
 * agreeing about what that means.
 */
async function fulfil(tx: Database, orderId: string): Promise<void> {
  await tx.execute(sql`
    insert into entitlements (id, user_id, product_id, order_id, source)
    select ${uuidv7()}, o.buyer_user_id, i.product_id, o.id, 'purchase'
      from orders o join order_items i on i.order_id = o.id
     where o.id = ${orderId}::uuid
    on conflict (user_id, product_id) do nothing
  `);
  await freezeOrderEconomics(tx, orderId);
}

/**
 * Freezes what this sale charged. NOT a settlement.
 *
 * `fee_schedules` and `fee_lines` are append-only and must total the gross, so
 * this is the sale's economics made permanent: change the commission rule
 * tomorrow and this order still says what it said today.
 *
 * No ledger account moves. The seller has no claim on money until settlement,
 * which is a different operation, needs a real provider settlement event and
 * payout rails, and is not built. What this writes is the answer to "what did
 * this sale charge?", so that settlement — whenever it arrives — reads a frozen
 * decision rather than re-resolving rules that may have changed since.
 *
 * Runs inside the confirming transaction, so a sale can never exist without it.
 */
export async function freezeOrderEconomics(db: Database, orderId: string): Promise<void> {
  const existing = await db.execute<{ id: string }>(sql`
    select id from fee_schedules where subject_type = 'order' and subject_id = ${orderId}::uuid
  `);
  if (existing.rows.length > 0) return;

  const rows = await db.execute<{
    [key: string]: unknown;
    total_minor: string | bigint;
    currency: string;
    store_id: string;
    country_code: string | null;
    kind: string;
  }>(sql`
    select o.total_minor, o.currency, o.store_id, s.country_code,
           (select kind from products p join order_items i on i.product_id = p.id
             where i.order_id = o.id limit 1) as kind
      from orders o join stores s on s.id = o.store_id
     where o.id = ${orderId}::uuid and o.status = 'paid'
  `);
  const row = rows.rows[0];
  if (row === undefined) return;

  await freezeSchedule(db, {
    subjectType: "order",
    subjectId: orderId,
    gross: money(BigInt(row.total_minor), row.currency),
    // The product's own kind picks the commission rule. Never a client value.
    transactionType: row.kind,
    storeId: row.store_id,
    ...(row.country_code !== null ? { countryCode: row.country_code } : {}),
  });
}

/** The payment attempts for one order, for the buyer who owns it. */
export async function findOrderPayment(
  db: Database,
  actor: Actor,
  orderId: string,
): Promise<PaymentRecord | undefined> {
  await authorize(db, actor, "order.read_own");
  const rows = await db.execute<PaymentRow>(sql`
    select p.id, p.order_id, p.provider, p.provider_ref, p.status, p.amount_minor, p.currency
      from payments p join orders o on o.id = p.order_id
     where p.order_id = ${orderId}::uuid and o.buyer_user_id = ${actor.userId}::uuid
     order by p.created_at desc limit 1
  `);
  const row = rows.rows[0];
  return row === undefined ? undefined : toPayment(row);
}
