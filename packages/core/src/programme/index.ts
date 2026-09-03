import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { uuidv7 } from "../ids";
import { audit } from "../audit";
import { money, type Money } from "../money";

/**
 * Programmes, and the four things this module refuses to let anybody confuse.
 *
 * ---------------------------------------------------------------------------
 *   1. the programme a person CHOSE          -> users.programme
 *   2. the state of their SUBSCRIPTION       -> programme_subscriptions.status
 *   3. the PAYMENT that would change it      -> orders / payments, not here
 *   4. what they are ENTITLED to right now   -> derived from 2, never from 1
 * ---------------------------------------------------------------------------
 *
 * Signup asks which programme somebody wants before it asks for anything else,
 * so the answer arrives long before any money does. Storing that answer on the
 * user row and letting it stand for "has paid" is the mistake this separation
 * exists to make impossible: `users.programme` is an intent, and `entitled`
 * below is computed from the subscription row alone.
 *
 * Two consequences follow, and both are requirements rather than side effects:
 *
 *   - Choosing Entrepreneur NEVER activates anything. It writes a subscription
 *     in `pending_payment`, which grants nothing at all.
 *   - Moving between programmes is an UPDATE on the account somebody already
 *     has. There is no path in this module that requires a second account, and
 *     none may be added: a Vendeur who becomes an Entrepreneur keeps their
 *     roles, their store, their wallet and their ledger history because it is
 *     the same `users.id` throughout.
 */
export const PROGRAMMES = ["vendeur", "entrepreneur"] as const;
export type Programme = (typeof PROGRAMMES)[number];

export function isProgramme(value: unknown): value is Programme {
  return typeof value === "string" && (PROGRAMMES as readonly string[]).includes(value);
}

/**
 * Subscription states. `active` is deliberately unreachable from this module.
 *
 * Nothing here can set it, because setting it means somebody has paid and no
 * payment provider is implemented — iPayMoney is confirmed but its adapter
 * throws rather than pretending. An `activate()` written now would either take
 * a payment reference it cannot verify or take none at all, and the second is
 * how a subscription becomes active because a button was pressed. Activation
 * belongs to the milestone that has a provider to verify against.
 *
 * `past_due` and `expired` are declared for the same reason the column exists:
 * the lifecycle is designed once, and the states that renewal will need are not
 * invented under pressure later.
 */
export const SUBSCRIPTION_STATUSES = [
  "pending_payment", "active", "past_due", "cancelled", "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The statuses the partial unique index treats as occupying the slot. */
const LIVE_STATUSES: readonly SubscriptionStatus[] = ["pending_payment", "active", "past_due"];

export interface ProgrammePrice {
  readonly programme: Programme;
  readonly price: Money;
  /** Billing period length. One month at launch; data, so renewal can differ. */
  readonly periodDays: number;
}

/**
 * The setting key the price is read from. `2 000 FCFA` is what the business
 * decided today, not a constant of the software: it is a default here and an
 * UPDATE in `platform_settings` when it changes, exactly like the OTP policy.
 *
 * XOF has ZERO decimal places, so 2 000 francs is `2000n` minor units. Writing
 * `200000n` here — the reflex from two-decimal currencies — would charge a
 * hundred times the price, and nothing downstream would catch it.
 */
export const PROGRAMME_PRICE_SETTING_KEY = "programme.pricing";

export const PROGRAMME_PRICES: Readonly<Record<Programme, ProgrammePrice | null>> = {
  vendeur: null,
  entrepreneur: { programme: "entrepreneur", price: money(2000n, "XOF"), periodDays: 30 },
};

/**
 * Reads the entrepreneur price, falling back field by field.
 *
 * A malformed settings row must never be able to produce a price of zero or a
 * price in the wrong currency, so each field is validated on its own and
 * anything unusable falls back to the default rather than through it.
 */
export async function loadProgrammePrice(db: Database): Promise<ProgrammePrice> {
  const fallback = PROGRAMME_PRICES.entrepreneur as ProgrammePrice;
  const rows = await db.execute<{ value: Record<string, unknown> | null }>(sql`
    select value from platform_settings where key = ${PROGRAMME_PRICE_SETTING_KEY}
  `);
  const stored = rows.rows[0]?.value;
  if (stored === null || stored === undefined || typeof stored !== "object") return fallback;

  const raw = (stored as Record<string, unknown>)["entrepreneur"];
  if (raw === null || raw === undefined || typeof raw !== "object") return fallback;
  const entry = raw as Record<string, unknown>;

  const minor = entry["priceMinor"];
  const currency = entry["currency"];
  const periodDays = entry["periodDays"];

  return {
    programme: "entrepreneur",
    price:
      typeof minor === "number" && Number.isSafeInteger(minor) && minor > 0
        && typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
        ? money(BigInt(minor), currency)
        : fallback.price,
    periodDays:
      typeof periodDays === "number" && Number.isSafeInteger(periodDays) && periodDays > 0
        ? periodDays
        : fallback.periodDays,
  };
}

export interface Subscription {
  readonly id: string;
  readonly userId: string;
  readonly programme: Programme;
  readonly status: SubscriptionStatus;
  readonly price: Money;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly orderId: string | null;
}

interface SubscriptionRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  programme: string;
  status: string;
  price_minor: string | number | bigint;
  currency: string;
  current_period_start: string | null;
  current_period_end: string | null;
  order_id: string | null;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    programme: row.programme as Programme,
    status: row.status as SubscriptionStatus,
    price: money(BigInt(row.price_minor), row.currency),
    currentPeriodStart: row.current_period_start === null ? null : new Date(row.current_period_start),
    currentPeriodEnd: row.current_period_end === null ? null : new Date(row.current_period_end),
    orderId: row.order_id,
  };
}

/** The live subscription for a programme, or null. Never more than one. */
export async function liveSubscription(
  db: Database,
  userId: string,
  programme: Programme = "entrepreneur",
): Promise<Subscription | null> {
  const rows = await db.execute<SubscriptionRow>(sql`
    select id, user_id, programme, status, price_minor, currency,
           current_period_start, current_period_end, order_id
      from programme_subscriptions
     where user_id = ${userId}
       and programme = ${programme}
       and status in ('pending_payment','active','past_due')
     limit 1
  `);
  const row = rows.rows[0];
  return row === undefined ? null : toSubscription(row);
}

export interface ProgrammeState {
  /** What the person chose. An intent, and nothing more. */
  readonly chosen: Programme;
  readonly subscription: Subscription | null;
  /**
   * Whether the paid programme is actually in force right now.
   *
   * Computed from the subscription and the clock — never from `chosen`, and
   * never cached on the user row, because a cached entitlement is a bill
   * somebody stopped paying that nobody noticed. Today this is always false:
   * nothing can reach `active` until a payment provider exists to prove it.
   */
  readonly entitled: boolean;
}

export async function programmeState(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<ProgrammeState> {
  const chosenRows = await db.execute<{ programme: string }>(sql`
    select programme from users where id = ${userId} limit 1
  `);
  const chosen = chosenRows.rows[0]?.programme;
  if (chosen === undefined) {
    throw new Error(`No such user: ${userId}`);
  }

  const subscription = await liveSubscription(db, userId, "entrepreneur");
  return {
    chosen: isProgramme(chosen) ? chosen : "vendeur",
    subscription,
    entitled: isEntitled(subscription, now),
  };
}

export function isEntitled(subscription: Subscription | null, now: Date = new Date()): boolean {
  if (subscription === null) return false;
  if (subscription.status !== "active") return false;
  // An `active` row whose period has run out is not entitlement, it is a row
  // nobody expired yet. The clock decides, not the status alone.
  const end = subscription.currentPeriodEnd;
  return end !== null && end.getTime() > now.getTime();
}

export interface ChooseOutcome {
  readonly programme: Programme;
  readonly subscription: Subscription | null;
}

/**
 * Records the programme somebody chose, and nothing else.
 *
 * For `vendeur` this is one UPDATE: the free programme has no subscription and
 * needs none. Any live entrepreneur subscription that was still waiting to be
 * paid is cancelled, because leaving a `pending_payment` row behind for a
 * person who went back to the free programme is an invoice they never agreed
 * to and a slot the unique index will not let them re-take later.
 *
 * For `entrepreneur` it is that same UPDATE plus a `pending_payment` row
 * carrying the price frozen at the moment of choosing. It confers nothing. The
 * caller that shows the person what happens next must say so plainly rather
 * than congratulating them on a subscription they have not paid for.
 *
 * Called again with a programme somebody already has, it is idempotent: the
 * existing subscription is returned untouched rather than replaced, so a
 * double-submitted form does not restate the price against a later setting.
 */
export async function chooseProgramme(
  db: Database,
  input: {
    readonly userId: string;
    readonly programme: Programme;
    readonly actorUserId?: string | undefined;
  },
): Promise<ChooseOutcome> {
  const price = input.programme === "entrepreneur" ? await loadProgrammePrice(db) : null;

  const subscription = await db.transaction(async (tx) => {
    const updated = await tx.execute<{ id: string }>(sql`
      update users set programme = ${input.programme}, updated_at = now()
       where id = ${input.userId}
      returning id
    `);
    if (updated.rows.length === 0) throw new Error(`No such user: ${input.userId}`);

    if (input.programme === "vendeur") {
      await tx.execute(sql`
        update programme_subscriptions
           set status = 'cancelled', updated_at = now()
         where user_id = ${input.userId}
           and status = 'pending_payment'
      `);
      return null;
    }

    const existing = await tx.execute<SubscriptionRow>(sql`
      select id, user_id, programme, status, price_minor, currency,
             current_period_start, current_period_end, order_id
        from programme_subscriptions
       where user_id = ${input.userId}
         and programme = 'entrepreneur'
         and status in ('pending_payment','active','past_due')
       limit 1
    `);
    const found = existing.rows[0];
    if (found !== undefined) return toSubscription(found);

    const id = uuidv7();
    const frozen = price as ProgrammePrice;
    await tx.execute(sql`
      insert into programme_subscriptions
        (id, user_id, programme, status, price_minor, currency)
      values (${id}, ${input.userId}, 'entrepreneur', 'pending_payment',
              ${frozen.price.amountMinor.toString()}, ${frozen.price.currency})
    `);
    return {
      id,
      userId: input.userId,
      programme: "entrepreneur" as const,
      status: "pending_payment" as const,
      price: frozen.price,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      orderId: null,
    };
  });

  await audit(db, {
    actorKind: input.actorUserId === undefined ? "system" : "user",
    ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
    action: "programme.chosen",
    targetType: "user",
    targetId: input.userId,
    context: {
      programme: input.programme,
      // Said out loud in the audit trail, because the day somebody asks why a
      // person had no entrepreneur features the answer is in this line.
      subscriptionStatus: subscription?.status ?? "none",
      activated: false,
    },
  });

  return { programme: input.programme, subscription };
}

export { LIVE_STATUSES as LIVE_SUBSCRIPTION_STATUSES };
