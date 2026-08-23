import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { requireElevation } from "../auth/session-bridge";
import { authorize, type Actor } from "../authz";
import { uuidv7 } from "../ids";
import { logger } from "../observability";
import { revokeEntitlementsForOrder } from "../content/access";
import { queueNotification } from "../notifications";
import {
  classifyRefundFailure, classifyRefundResponse, screenDetail,
  type PaymentProvider, type RefundAttemptOutcome, type RefundStatus,
} from "../payments";
import { loadRefundPolicy, type RefundPolicy } from "./policy";
import { RefundNotFoundError, RefundNotPayableError, REFUND_COLUMNS, toRefund, type RefundRecord, type RefundRow } from "./record";
import { assertRefundTransition, type RefundResolutionSource, type RefundState } from "./state";

/**
 * Executing a refund, and resolving one whose outcome we never learned.
 *
 * The whole file turns on a single ordering, stated once here because every
 * function below depends on it:
 *
 *     THE ATTEMPT ROW IS COMMITTED BEFORE THE PROVIDER IS CALLED.
 *
 * Not written in the same transaction as the call — there is no such thing, a
 * network request is not transactional — but committed, durably, first. If the
 * process dies one instruction later, what remains in the database is a refund
 * marked `in_flight` and an attempt with no `finished_at`. That is a request
 * that MAY be out there, and the system treats it as exactly that: it is never
 * retried, it is swept to `in_doubt`, and it is resolved by asking rather than
 * by assuming.
 *
 * The alternative ordering — call, then record what happened — makes a crash
 * indistinguishable from a refund that was never attempted. That reading is
 * how a buyer gets their money back twice.
 */

const log = logger.child({ component: "refunds" });

/** Derived, never supplied. A caller has no say in what the provider is told. */
export function refundIdempotencyKey(refundId: string, attemptNo: number): string {
  return `refund:${refundId}:${attemptNo}`;
}

export interface RefundExecutionResult {
  readonly refundId: string;
  readonly status: RefundState;
  readonly attemptNo: number;
  readonly outcome: RefundAttemptOutcome["kind"];
  readonly stage: RefundAttemptOutcome["stage"];
  readonly providerRefundRef: string | null;
}

interface LockedRefund {
  id: string;
  status: RefundState;
  attemptCount: number;
  amountMinor: bigint;
  currency: string;
  provider: string;
  orderId: string;
  paymentId: string;
  paymentProviderRef: string | null;
  paymentStatus: string;
  paymentAmountMinor: bigint;
  paymentCurrency: string;
  buyerUserId: string;
  requestedByUserId: string | null;
  reason: string;
  openAttempts: number;
  retryReady: boolean;
}

/**
 * Takes the refund row and everything that must agree with it, under one lock.
 *
 * `for update` on the refund alone would be enough to serialise two operators.
 * The join exists for a different reason: the amount and currency are re-read
 * from `payments` at the moment of dispatch and compared, so a refund row
 * edited directly in the database — the one attack the frozen snapshot cannot
 * prevent by itself — is caught before the provider is called rather than
 * afterwards by reconciliation.
 */
async function lockRefund(tx: Database, refundId: string): Promise<LockedRefund | undefined> {
  const rows = await tx.execute<{
    [key: string]: unknown;
    id: string;
    status: string;
    attempt_count: number;
    amount_minor: string | bigint;
    currency: string;
    provider: string;
    order_id: string;
    payment_id: string;
    payment_provider_ref: string | null;
    payment_status: string;
    payment_amount_minor: string | bigint;
    payment_currency: string;
    buyer_user_id: string;
    requested_by_user_id: string | null;
    reason: string;
    open_attempts: string | number;
    retry_ready: boolean;
  }>(sql`
    select r.id, r.status, r.attempt_count, r.amount_minor, r.currency, r.provider,
           r.order_id, r.payment_id, r.reason, r.requested_by_user_id,
           p.provider_ref as payment_provider_ref,
           p.status as payment_status,
           p.amount_minor as payment_amount_minor,
           p.currency as payment_currency,
           o.buyer_user_id,
           (select count(*) from refund_attempts a
             where a.refund_id = r.id and a.finished_at is null) as open_attempts,
           (r.not_before is null or r.not_before <= now()) as retry_ready
      from refunds r
      join payments p on p.id = r.payment_id
      join orders o on o.id = r.order_id
     where r.id = ${refundId}::uuid
     for update of r
  `);

  const row = rows.rows[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    status: row.status as RefundState,
    attemptCount: Number(row.attempt_count),
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    provider: row.provider,
    orderId: row.order_id,
    paymentId: row.payment_id,
    paymentProviderRef: row.payment_provider_ref,
    paymentStatus: row.payment_status,
    paymentAmountMinor: BigInt(row.payment_amount_minor),
    paymentCurrency: row.payment_currency,
    buyerUserId: row.buyer_user_id,
    requestedByUserId: row.requested_by_user_id,
    reason: row.reason,
    openAttempts: Number(row.open_attempts),
    retryReady: row.retry_ready,
  };
}

interface DispatchTicket {
  readonly refundId: string;
  /** The order this refund settles — the key access revocation is scoped to. */
  readonly orderId: string;
  readonly attemptId: string;
  readonly attemptNo: number;
  readonly idempotencyKey: string;
  readonly providerRef: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly reason: string;
  readonly buyerUserId: string;
  readonly from: RefundState;
}

/**
 * PHASE ONE: claim the refund and commit the evidence, before anything is sent.
 *
 * Everything this does is inside one transaction that commits before the
 * provider hears a word. What it establishes:
 *
 *   - the refund row is locked, so two operators pressing at once serialise;
 *   - the state is legal to leave from, checked against the machine AND named
 *     in the guarded UPDATE so the database refuses a stale one;
 *   - no attempt is already open, so a crashed request is never accompanied by
 *     a second one;
 *   - the frozen amount still matches the payment;
 *   - the attempt row exists, with a derived idempotency key, marked open.
 *
 * Returns undefined when the refund is not dispatchable — already resolved,
 * already in flight, out of attempts, or still inside its backoff — because
 * those are ordinary queue conditions rather than errors.
 */
async function claimForDispatch(
  db: Database,
  refundId: string,
  policy: RefundPolicy,
  who: { actorUserId: string | undefined; actorKind: "user" | "job" },
): Promise<DispatchTicket> {
  return db.transaction(async (tx) => {
    const refund = await lockRefund(tx, refundId);
    if (refund === undefined) throw new RefundNotFoundError(refundId);

    /*
     * The state machine, consulted before the database is asked to move.
     *
     * `owed → in_flight` and `failed → in_flight` are the only legal starts.
     * `in_doubt → in_flight` throws here with the message that explains why,
     * and the guarded UPDATE below would refuse it a second time even if this
     * check were deleted.
     */
    assertRefundTransition(refund.status, "in_flight");

    if (refund.paymentStatus !== "succeeded") {
      throw new RefundNotPayableError(
        "The payment behind this refund is not succeeded. Refunding money that " +
          "never arrived would send out funds Afrinext never received.",
      );
    }
    if (
      refund.amountMinor !== refund.paymentAmountMinor ||
      refund.currency !== refund.paymentCurrency
    ) {
      // The frozen snapshot and its source disagree. Something edited a row.
      throw new RefundNotPayableError(
        "This refund's amount no longer matches its payment. Refusing to send " +
          "an amount nothing corroborates.",
      );
    }
    if (refund.paymentProviderRef === null) {
      throw new RefundNotPayableError(
        "The payment has no provider reference, so there is no charge to reverse.",
      );
    }
    if (refund.openAttempts > 0) {
      throw new RefundNotPayableError(
        "An attempt for this refund is still open. Its outcome is unknown, and " +
          "sending a second request is exactly how a buyer is refunded twice.",
      );
    }
    if (refund.attemptCount >= policy.maxAttempts) {
      throw new RefundNotPayableError(
        `This refund has used all ${policy.maxAttempts} permitted attempts. ` +
          "Resolve it against a provider statement instead.",
      );
    }
    if (!refund.retryReady) {
      throw new RefundNotPayableError("This refund is still inside its retry backoff window.");
    }

    const attemptNo = refund.attemptCount + 1;
    const idempotencyKey = refundIdempotencyKey(refund.id, attemptNo);

    /*
     * The guarded transition. `where status = <what we read>` is what makes
     * this safe rather than the check above: a second caller that somehow got
     * past the lock matches no rows and changes nothing.
     */
    const moved = await tx.execute(sql`
      update refunds
         set status = 'in_flight',
             attempt_count = ${attemptNo},
             requested_by_user_id = coalesce(requested_by_user_id, ${who.actorUserId ?? null}),
             updated_at = now()
       where id = ${refund.id}::uuid and status = ${refund.status}
    `);
    if ((moved.rowCount ?? 0) === 0) {
      throw new RefundNotPayableError("This refund changed underneath the request.");
    }

    const attemptId = uuidv7();
    await tx.execute(sql`
      insert into refund_attempts (id, refund_id, attempt_no, idempotency_key,
                                   actor_user_id, actor_kind)
      values (${attemptId}, ${refund.id}, ${attemptNo}, ${idempotencyKey},
              ${who.actorUserId ?? null}, ${who.actorKind})
    `);

    await audit(tx, {
      actorKind: who.actorKind,
      ...(who.actorUserId !== undefined ? { actorUserId: who.actorUserId } : {}),
      action: "refund.attempt_started",
      targetType: "refund",
      targetId: refund.id,
      context: {
        attemptNo,
        // The key is a derived, non-secret identifier and is the thread that
        // ties an audit line to a provider request during an investigation.
        idempotencyKey,
        amountMinor: refund.amountMinor.toString(),
        currency: refund.currency,
        from: refund.status,
      },
    });

    return {
      refundId: refund.id,
      orderId: refund.orderId,
      attemptId,
      attemptNo,
      idempotencyKey,
      providerRef: refund.paymentProviderRef,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      reason: refund.reason,
      buyerUserId: refund.buyerUserId,
      from: refund.status,
    };
  });
}

/**
 * PHASE THREE: close the attempt and move the refund to what we learned.
 *
 * Every write here is guarded on the state phase one left behind, so a
 * duplicate settlement of the same attempt — two callers, a retry of this
 * function, a webhook arriving mid-flight — moves nothing twice.
 */
async function settleAttempt(
  db: Database,
  ticket: DispatchTicket,
  outcome: RefundAttemptOutcome,
  policy: RefundPolicy,
  source: RefundResolutionSource,
): Promise<RefundExecutionResult> {
  return db.transaction(async (tx) => {
    // Closing the attempt first, and once. The append-only trigger refuses a
    // second close, so a duplicate settlement fails loudly rather than
    // rewriting evidence.
    const closed = await tx.execute(sql`
      update refund_attempts
         set finished_at = now(),
             outcome = ${outcome.kind},
             stage = ${outcome.stage},
             provider_refund_ref = ${outcome.providerRefundRef ?? null},
             detail = ${outcome.detail}
       where id = ${ticket.attemptId}::uuid and finished_at is null
    `);
    if ((closed.rowCount ?? 0) === 0) {
      // Somebody else settled it. Report what the refund is now, change nothing.
      const current = await tx.execute<RefundRow>(sql`
        select ${REFUND_COLUMNS} from refunds where id = ${ticket.refundId}::uuid
      `);
      const row = current.rows[0];
      return {
        refundId: ticket.refundId,
        status: (row?.status ?? "in_doubt") as RefundState,
        attemptNo: ticket.attemptNo,
        outcome: outcome.kind,
        stage: outcome.stage,
        providerRefundRef: row?.provider_refund_ref ?? null,
      };
    }

    /*
     * `pending` is not a resolution.
     *
     * The provider accepted the request and will tell us later. The refund
     * stays in flight — which means it is not retryable, because in_flight is
     * not a state a retry may leave from. A webhook or a status query ends it.
     */
    if (outcome.kind === "pending") {
      if (outcome.providerRefundRef !== undefined) {
        await tx.execute(sql`
          update refunds set provider_refund_ref = ${outcome.providerRefundRef}, updated_at = now()
           where id = ${ticket.refundId}::uuid and provider_refund_ref is null
        `);
      }
      return {
        refundId: ticket.refundId,
        status: "in_flight",
        attemptNo: ticket.attemptNo,
        outcome: outcome.kind,
        stage: outcome.stage,
        providerRefundRef: outcome.providerRefundRef ?? null,
      };
    }

    const to: RefundState = outcome.kind;
    assertRefundTransition("in_flight", to);

    const backoff = policy.retryBackoffSeconds;
    const moved = await tx.execute(sql`
      update refunds
         set status = ${to},
             resolved_by = ${source},
             resolution_evidence = ${outcome.detail},
             provider_refund_ref = coalesce(${outcome.providerRefundRef ?? null}, provider_refund_ref),
             resolved_at = case when ${to === "succeeded"} then now() else resolved_at end,
             -- Only a proven failure earns a next attempt, and not immediately.
             not_before = case when ${to === "failed"}
                               then now() + make_interval(secs => ${backoff})
                               else not_before end,
             updated_at = now()
       where id = ${ticket.refundId}::uuid and status = 'in_flight'
    `);

    if ((moved.rowCount ?? 0) > 0) {
      await audit(tx, {
        actorKind: "system",
        action:
          to === "succeeded" ? "refund.succeeded"
          : to === "failed" ? "refund.failed"
          : "refund.in_doubt",
        targetType: "refund",
        targetId: ticket.refundId,
        context: {
          attemptNo: ticket.attemptNo,
          stage: outcome.stage,
          resolvedBy: source,
          providerRefundRef: outcome.providerRefundRef ?? null,
          // The screened detail, not the provider's raw words.
          detail: outcome.detail,
        },
      });

      await notifyOutcome(tx, ticket, to);
      await revokeAccessIfRefunded(tx, ticket.orderId, to);
    }

    return {
      refundId: ticket.refundId,
      status: to,
      attemptNo: ticket.attemptNo,
      outcome: outcome.kind,
      stage: outcome.stage,
      providerRefundRef: outcome.providerRefundRef ?? null,
    };
  });
}

/**
 * What a succeeded refund does to the buyer's access.
 *
 * Called from BOTH places a refund can reach `succeeded` — the execution path
 * and the provider-resolution path — because two code paths that both decide
 * "the money went back" must agree about what that means for the goods.
 *
 * Only `succeeded` revokes. A refund that failed, or whose outcome we never
 * learned, leaves access exactly as it was: taking a buyer's file away on a
 * refund that did not actually pay them is the worst of both outcomes.
 */
async function revokeAccessIfRefunded(
  tx: Database,
  orderId: string,
  to: RefundState,
): Promise<void> {
  if (to !== "succeeded") return;
  const revoked = await revokeEntitlementsForOrder(tx, orderId, "refund.succeeded");
  if (revoked > 0) {
    log.info("entitlements revoked after refund", { orderId, revoked });
  }
}

async function notifyOutcome(
  tx: Database,
  ticket: { refundId: string; buyerUserId: string },
  to: RefundState,
): Promise<void> {
  const kind =
    to === "succeeded" ? "refund.succeeded"
    : to === "failed" ? "refund.failed"
    : to === "in_doubt" ? "refund.in_doubt"
    : undefined;
  if (kind === undefined) return;
  await queueNotification(tx, {
    kind,
    recipientUserId: ticket.buyerUserId,
    subjectType: "refund",
    subjectId: ticket.refundId,
    payload: { outcome: to },
  });
}

/**
 * PHASE TWO, wrapped around one and three: send the request.
 *
 * The provider call happens OUTSIDE any transaction, deliberately. Holding a
 * database transaction open across a network request to a third party is how a
 * slow provider becomes a table full of blocked locks, and it would not make
 * anything more atomic — a refund that left the building cannot be rolled back
 * by a database.
 */
async function dispatch(
  db: Database,
  provider: PaymentProvider,
  ticket: DispatchTicket,
  policy: RefundPolicy,
): Promise<RefundExecutionResult> {
  let outcome: RefundAttemptOutcome;
  try {
    const result = await provider.refund({
      providerRef: ticket.providerRef,
      amount: { amountMinor: ticket.amountMinor, currency: ticket.currency },
      reason: ticket.reason,
      idempotencyKey: ticket.idempotencyKey,
    });
    outcome = classifyRefundResponse(result);
  } catch (error: unknown) {
    /*
     * The correction, in one place.
     *
     * Nothing here reads an HTTP status to decide whether money moved. The
     * classifier asks only how far the request got, and anything short of
     * "provably never left" becomes `in_doubt`.
     */
    outcome = classifyRefundFailure(error);
    log.warn("refund attempt did not return a usable answer", {
      refundId: ticket.refundId,
      attemptNo: ticket.attemptNo,
      stage: outcome.stage,
      classifiedAs: outcome.kind,
    });
  }

  return settleAttempt(db, ticket, outcome, policy, "response");
}

/**
 * Executes a refund, on a finance user's authority.
 *
 * Two gates, and they answer different questions. `authorize()` asks whether
 * this actor may ever execute refunds; `requireElevation()` asks whether they
 * re-verified recently — whether they are present right now, rather than a
 * stolen cookie from last Tuesday. Money leaving needs both.
 */
export async function executeRefund(
  db: Database,
  actor: Actor,
  provider: PaymentProvider,
  refundId: string,
): Promise<RefundExecutionResult> {
  await authorize(db, actor, "refund.execute");
  requireElevation(actor, "refund.execute");

  const policy = await loadRefundPolicy(db);

  /*
   * The request is audited BEFORE the claim, and deliberately.
   *
   * A refusal is as interesting as a success here: "finance user X tried to
   * execute this refund and was refused because an attempt was already open"
   * is exactly the line an investigation needs, and auditing after the claim
   * would record only the attempts that got through.
   */
  await audit(db, {
    actorKind: "user",
    actorUserId: actor.userId,
    action: "refund.execution_requested",
    targetType: "refund",
    targetId: refundId,
    context: { requestedBy: actor.userId },
  });

  const ticket = await claimForDispatch(db, refundId, policy, {
    actorUserId: actor.userId,
    actorKind: "user",
  });

  return dispatch(db, provider, ticket, policy);
}

/**
 * Retries a refund that is provably safe to retry, on the scheduler's behalf.
 *
 * The scheduler may only continue an authorisation a human already gave: a
 * refund with no `requested_by_user_id` has never been authorised by anyone,
 * and no amount of cron makes it authorised. That check is what keeps
 * "automatic retries" from becoming "automatic refunds".
 */
async function retryAuthorisedRefund(
  db: Database,
  provider: PaymentProvider,
  refundId: string,
  policy: RefundPolicy,
): Promise<RefundExecutionResult> {
  const ticket = await claimForDispatch(db, refundId, policy, {
    actorUserId: undefined,
    actorKind: "job",
  });
  return dispatch(db, provider, ticket, policy);
}

// ---------------------------------------------------------------------------
// Resolving an unknown outcome
// ---------------------------------------------------------------------------

export interface RefundResolution {
  readonly refundId: string;
  readonly status: RefundState;
  readonly resolved: boolean;
  readonly reason: string;
}

/**
 * Asks the provider what became of a refund whose outcome we never learned.
 *
 * Only two answers resolve anything, and both are positive statements:
 *
 *   succeeded, with a reference   → the money went back. Terminal.
 *   failed, WITH evidence        → the provider states no refund exists. The
 *                                  refund becomes retryable, because there is
 *                                  now proof there is nothing to duplicate.
 *
 * A `pending` answer, a `failed` with no evidence, an unreachable provider, or
 * a provider with no query API at all all leave the refund exactly where it
 * was. That is not a failure of this function — an unresolved `in_doubt` is a
 * correct outcome, and the queue is where it waits for a person.
 */
export async function resolveRefundFromProvider(
  db: Database,
  provider: PaymentProvider,
  refundId: string,
): Promise<RefundResolution> {
  const rows = await db.execute<RefundRow & { last_key: string | null }>(sql`
    select ${REFUND_COLUMNS},
           (select a.idempotency_key from refund_attempts a
             where a.refund_id = refunds.id order by a.attempt_no desc limit 1) as last_key
      from refunds where id = ${refundId}::uuid
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new RefundNotFoundError(refundId);
  const refund = toRefund(row);

  if (refund.status !== "in_doubt" && refund.status !== "in_flight") {
    return {
      refundId,
      status: refund.status,
      resolved: false,
      reason: "already_resolved",
    };
  }
  if (provider.getRefund === undefined) {
    /*
     * The provider cannot be asked.
     *
     * Not an error and not a bug — it is a fact about the provider that turns
     * every ambiguous refund into a manual process, which is why it is
     * reported by name rather than swallowed.
     */
    return { refundId, status: refund.status, resolved: false, reason: "provider_has_no_query" };
  }

  let status: RefundStatus;
  try {
    status = await provider.getRefund({
      ...(refund.providerRefundRef !== null
        ? { providerRefundRef: refund.providerRefundRef }
        : {}),
      ...(row.last_key !== null ? { idempotencyKey: row.last_key } : {}),
    });
  } catch (error: unknown) {
    // A failed question tells us nothing about the answer.
    log.warn("refund status query failed", { refundId, cause: screenDetail(error) });
    return { refundId, status: refund.status, resolved: false, reason: "query_failed" };
  }

  return applyResolution(db, refund, {
    source: "status_query",
    status: status.status,
    providerRefundRef: status.providerRefundRef,
    ...(status.notExecutedEvidence !== undefined
      ? { notExecutedEvidence: status.notExecutedEvidence }
      : {}),
    raw: status.raw,
  });
}

interface ResolutionInput {
  readonly source: RefundResolutionSource;
  readonly status: "succeeded" | "failed" | "pending";
  readonly providerRefundRef: string;
  readonly notExecutedEvidence?: string | undefined;
  readonly raw: unknown;
}

/**
 * Turns an outside statement into a state change, or refuses to.
 *
 * Shared by the status-query path and the webhook path so that "what counts as
 * evidence" is one rule rather than two that drift. Manual reconciliation does
 * NOT come through here: a person's statement carries different requirements
 * and a different authorisation model.
 */
async function applyResolution(
  db: Database,
  refund: RefundRecord,
  input: ResolutionInput,
): Promise<RefundResolution> {
  if (input.status === "pending") {
    return { refundId: refund.id, status: refund.status, resolved: false, reason: "still_pending" };
  }

  if (input.status === "failed") {
    const evidence = input.notExecutedEvidence;
    if (evidence === undefined || evidence.trim() === "") {
      /*
       * A "failed" with nothing behind it changes nothing.
       *
       * This is the same refusal `classifyRefundResponse` makes about a
       * response, restated for a status query and a webhook, because the
       * temptation is identical in all three places: an unadorned "failed" is
       * indistinguishable from an accepted refund reported badly, and treating
       * it as proof is how an unknown becomes a retry.
       */
      return {
        refundId: refund.id,
        status: refund.status,
        resolved: false,
        reason: "failure_without_evidence",
      };
    }
  }

  const to: RefundState = input.status === "succeeded" ? "succeeded" : "failed";
  assertRefundTransition(refund.status, to);

  if (to === "succeeded" && (input.providerRefundRef === "" )) {
    return {
      refundId: refund.id,
      status: refund.status,
      resolved: false,
      reason: "success_without_reference",
    };
  }

  const detail = screenDetail(
    input.status === "failed" ? input.notExecutedEvidence : input.raw,
  );

  return db.transaction(async (tx) => {
    // Close any attempt still open: whatever we just learned ends the waiting.
    await tx.execute(sql`
      update refund_attempts
         set finished_at = now(),
             outcome = ${to},
             stage = 'transmitted',
             provider_refund_ref = coalesce(provider_refund_ref, ${input.providerRefundRef}),
             detail = ${`resolved by ${input.source}: ${detail}`}
       where refund_id = ${refund.id}::uuid and finished_at is null
    `);

    const moved = await tx.execute(sql`
      update refunds
         set status = ${to},
             resolved_by = ${input.source},
             resolution_evidence = ${detail},
             provider_refund_ref = coalesce(provider_refund_ref, ${input.providerRefundRef}),
             resolved_at = case when ${to === "succeeded"} then now() else resolved_at end,
             updated_at = now()
       where id = ${refund.id}::uuid and status = ${refund.status}
    `);

    if ((moved.rowCount ?? 0) === 0) {
      return { refundId: refund.id, status: refund.status, resolved: false, reason: "raced" };
    }

    await audit(tx, {
      actorKind: "system",
      action: to === "succeeded" ? "refund.succeeded" : "refund.failed",
      targetType: "refund",
      targetId: refund.id,
      context: { resolvedBy: input.source, from: refund.status, detail },
    });

    const buyer = await tx.execute<{ [key: string]: unknown; buyer_user_id: string }>(sql`
      select buyer_user_id from orders where id = ${refund.orderId}::uuid
    `);
    const recipient = buyer.rows[0]?.buyer_user_id;
    if (recipient !== undefined) {
      await notifyOutcome(tx, { refundId: refund.id, buyerUserId: recipient }, to);
    }
    await revokeAccessIfRefunded(tx, refund.orderId, to);

    return { refundId: refund.id, status: to, resolved: true, reason: input.source };
  });
}

/**
 * A verified refund webhook, applied.
 *
 * The event has already survived signature verification over the raw bytes and
 * the replay index — the same boundary charges go through, because a refund
 * webhook is not a second, weaker door. What remains is finding which refund it
 * belongs to and deciding whether it says enough to act on.
 */
export async function applyRefundEvent(
  db: Database,
  event: {
    providerRefundRef: string;
    /** The charge this event says it reverses, when the provider names one. */
    providerRef?: string | undefined;
    status: "succeeded" | "failed" | "pending";
    notExecutedEvidence?: string | undefined;
    raw: unknown;
    amount?: { amountMinor: bigint; currency: string } | undefined;
  },
  providerId: string,
): Promise<RefundResolution & { matched: boolean }> {
  /*
   * Matched on the provider's refund reference, or on ours.
   *
   * The second half matters: a refund that timed out has no provider reference
   * stored, so a webhook that arrives afterwards would match nothing at all if
   * the reference were the only key. The attempt's idempotency key is the
   * thread back to the refund, and it is a key we chose rather than one the
   * caller could guess.
   */
  const rows = await db.execute<RefundRow>(sql`
    select ${REFUND_COLUMNS} from refunds
     where refunds.provider = ${providerId}
       and (
         -- The reference the provider gave us when it answered.
         refunds.provider_refund_ref = ${event.providerRefundRef}
         -- Or the one an attempt recorded, when the refund row has not caught up.
         or exists (select 1 from refund_attempts a
                     where a.refund_id = refunds.id
                       and a.provider_refund_ref = ${event.providerRefundRef})
         -- Or the CHARGE the event says it reverses.
         --
         -- This arm is what makes a timed-out refund resolvable by webhook at
         -- all: when the response never arrived we hold no refund reference, so
         -- the charge is the only thread back. Matched through the payments
         -- table, and only from the event's providerRef field: a refund reference that
         -- happens to be a charge reference matches nothing, which is how a
         -- confused event stays unknown instead of moving the wrong object.
         or (${event.providerRef ?? null}::text is not null
             and exists (select 1 from payments p
                          where p.id = refunds.payment_id
                            and p.provider = ${providerId}
                            and p.provider_ref = ${event.providerRef ?? null}))
       )
     limit 1
  `);
  const row = rows.rows[0];
  if (row === undefined) {
    return {
      refundId: event.providerRefundRef,
      status: "in_doubt",
      resolved: false,
      reason: "unknown_refund",
      matched: false,
    };
  }

  const refund = toRefund(row);

  // The amount must agree exactly, when the event states one. A near miss is a
  // mismatch, and a mismatch is not something to act on.
  if (event.amount !== undefined) {
    if (
      event.amount.amountMinor !== refund.amount.amountMinor ||
      event.amount.currency !== refund.amount.currency
    ) {
      log.warn("refund webhook amount does not match the refund", { refundId: refund.id });
      return {
        refundId: refund.id,
        status: refund.status,
        resolved: false,
        reason: "amount_mismatch",
        matched: true,
      };
    }
  }

  if (refund.status !== "in_doubt" && refund.status !== "in_flight") {
    return {
      refundId: refund.id,
      status: refund.status,
      resolved: false,
      reason: "already_resolved",
      matched: true,
    };
  }

  const applied = await applyResolution(db, refund, {
    source: "webhook",
    status: event.status,
    providerRefundRef: event.providerRefundRef,
    ...(event.notExecutedEvidence !== undefined
      ? { notExecutedEvidence: event.notExecutedEvidence }
      : {}),
    raw: event.raw,
  });
  return { ...applied, matched: true };
}

// ---------------------------------------------------------------------------
// The queue processor — an authenticated endpoint's worth of work, no daemon
// ---------------------------------------------------------------------------

export interface QueueRunReport {
  readonly sweptToInDoubt: number;
  readonly resolved: number;
  readonly retried: number;
  readonly examined: number;
}

/**
 * One pass over the refund queue. Called by an authenticated endpoint, never a
 * daemon: there is no worker infrastructure in this repository and inventing
 * some would be building a scheduler, not refund logic.
 *
 * What it deliberately does NOT do is start a refund nobody authorised. It
 * only ever:
 *
 *   1. sweeps requests that have been out too long to `in_doubt` — which takes
 *      nothing off the table, because in_doubt cannot be retried;
 *   2. asks the provider about unknowns, resolving the ones it can;
 *   3. retries refunds that are provably safe to retry AND that a finance user
 *      already authorised.
 *
 * `owed` is untouched. A refund nobody has authorised stays owed however many
 * times this runs.
 */
export async function processRefundQueue(
  db: Database,
  provider: PaymentProvider,
  options: { limit?: number } = {},
): Promise<QueueRunReport> {
  const policy = await loadRefundPolicy(db);
  const limit = Math.min(options.limit ?? policy.queueBatchSize, policy.queueBatchSize);

  const sweptToInDoubt = await sweepStuckRefunds(db, policy);

  const candidates = await db.execute<{ [key: string]: unknown; id: string; status: string }>(sql`
    select id, status from refunds
     where (
             status = 'in_doubt'
             or (status = 'failed'
                 and requested_by_user_id is not null
                 and attempt_count < ${policy.maxAttempts}
                 and (not_before is null or not_before <= now()))
           )
     order by created_at
     limit ${limit}
  `);

  let resolved = 0;
  let retried = 0;

  for (const candidate of candidates.rows) {
    try {
      if (candidate.status === "in_doubt") {
        const outcome = await resolveRefundFromProvider(db, provider, candidate.id);
        if (outcome.resolved) resolved += 1;
      } else {
        await retryAuthorisedRefund(db, provider, candidate.id, policy);
        retried += 1;
      }
    } catch (error: unknown) {
      // One bad refund does not stop the queue. It stays in the queue, which
      // is where a stuck refund belongs.
      log.warn("refund queue item failed", { refundId: candidate.id, cause: screenDetail(error) });
    }
  }

  await audit(db, {
    actorKind: "job",
    action: "refund.queue_processed",
    targetType: "refund_queue",
    context: { examined: candidates.rows.length, sweptToInDoubt, resolved, retried },
  });

  return { sweptToInDoubt, resolved, retried, examined: candidates.rows.length };
}

/**
 * Requests that have been out too long become `in_doubt`.
 *
 * This is the crash-recovery path, and it is safe precisely because of where it
 * lands. Sweeping to `in_doubt` says "we stopped waiting", not "it failed" — it
 * unlocks nothing, permits no retry, and moves the refund into the state whose
 * only exits require evidence. A sweep that moved these to `failed` instead
 * would turn every crashed process into a duplicate refund.
 */
export async function sweepStuckRefunds(db: Database, policy: RefundPolicy): Promise<number> {
  const stuck = await db.execute<{ [key: string]: unknown; id: string }>(sql`
    select r.id
      from refunds r join refund_attempts a on a.refund_id = r.id
     where r.status = 'in_flight'
       and a.finished_at is null
       and a.started_at <= now() - make_interval(secs => ${policy.stuckInFlightSeconds})
  `);

  let swept = 0;
  for (const row of stuck.rows) {
    const moved = await db.transaction(async (tx) => {
      await tx.execute(sql`
        update refund_attempts
           set finished_at = now(), outcome = 'in_doubt', stage = 'unknown',
               detail = 'no response before the stuck threshold; outcome unknown'
         where refund_id = ${row.id}::uuid and finished_at is null
      `);
      const result = await tx.execute(sql`
        update refunds
           set status = 'in_doubt', updated_at = now()
         where id = ${row.id}::uuid and status = 'in_flight'
      `);
      if ((result.rowCount ?? 0) === 0) return false;
      await audit(tx, {
        actorKind: "job",
        action: "refund.in_doubt",
        targetType: "refund",
        targetId: row.id,
        context: { reason: "stuck_in_flight", thresholdSeconds: policy.stuckInFlightSeconds },
      });
      return true;
    });
    if (moved) swept += 1;
  }
  return swept;
}
