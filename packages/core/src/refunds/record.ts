import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { DomainError } from "../errors";
import { uuidv7 } from "../ids";
import { money, type Money } from "../money";
import { queueNotification } from "../notifications";
import { REFUND_STATES, type RefundResolutionSource, type RefundState } from "./state";

/**
 * Recording that a refund is owed, and reading the queue.
 *
 * Creation is AUTOMATIC and execution is not. That split is the approved
 * answer to "who starts a refund": the moment an order reaches `refund_due`,
 * the debt exists as a row inside the same transaction — so no crash, no
 * missed sweep and no forgotten query can lose it. Money leaving requires a
 * finance user to act, so no bug can drain the merchant account unattended.
 */

export class RefundNotFoundError extends DomainError {
  override readonly name = "RefundNotFoundError";
  constructor(ref: string) {
    super("refund.refund_not_found", `No refund matches "${ref}".`);
  }
}

export class RefundNotPayableError extends DomainError {
  override readonly name = "RefundNotPayableError";
  constructor(why: string) {
    super("refund.not_payable", why);
  }
}

export interface RefundRecord {
  readonly id: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly provider: string;
  readonly status: RefundState;
  readonly amount: Money;
  readonly reason: string;
  readonly attemptCount: number;
  readonly providerRefundRef: string | null;
  readonly resolvedBy: RefundResolutionSource | null;
  readonly resolutionEvidence: string | null;
  readonly requestedByUserId: string | null;
  readonly reconciliationMode: string | null;
  readonly notBefore: Date | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

export interface RefundRow {
  [key: string]: unknown;
  id: string;
  order_id: string;
  payment_id: string;
  provider: string;
  status: string;
  amount_minor: string | bigint;
  currency: string;
  reason: string;
  attempt_count: number;
  provider_refund_ref: string | null;
  resolved_by: string | null;
  resolution_evidence: string | null;
  requested_by_user_id: string | null;
  reconciliation_mode: string | null;
  not_before: Date | string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

const asDate = (v: Date | string | null): Date | null =>
  v === null ? null : v instanceof Date ? v : new Date(v);

export function toRefund(row: RefundRow): RefundRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    paymentId: row.payment_id,
    provider: row.provider,
    status: row.status as RefundState,
    amount: money(BigInt(row.amount_minor), row.currency),
    reason: row.reason,
    attemptCount: Number(row.attempt_count),
    providerRefundRef: row.provider_refund_ref,
    resolvedBy: row.resolved_by as RefundResolutionSource | null,
    resolutionEvidence: row.resolution_evidence,
    requestedByUserId: row.requested_by_user_id,
    reconciliationMode: row.reconciliation_mode,
    notBefore: asDate(row.not_before),
    createdAt: asDate(row.created_at) as Date,
    resolvedAt: asDate(row.resolved_at),
  };
}

/**
 * Qualified with the table name, not bare.
 *
 * Several readers join `orders`, which also has an `id` and a `currency`, and
 * a bare column list turns into an ambiguous-reference error the moment
 * somebody adds a join. Naming the table is the fix that keeps working.
 */
export const REFUND_COLUMNS = sql`
  refunds.id, refunds.order_id, refunds.payment_id, refunds.provider, refunds.status,
  refunds.amount_minor, refunds.currency, refunds.reason, refunds.attempt_count,
  refunds.provider_refund_ref, refunds.resolved_by, refunds.resolution_evidence,
  refunds.requested_by_user_id, refunds.reconciliation_mode, refunds.not_before,
  refunds.created_at, refunds.resolved_at
`;

/**
 * Records that a refund is owed. Called from inside the confirming transaction.
 *
 * Everything financial about this row is COPIED from the payment in one
 * statement, with no parameter a caller could supply: amount, currency,
 * provider and the payment id all come out of `payments`, and the insert
 * refuses unless that payment actually succeeded. There is nothing here for a
 * route handler, a server action or a test to get wrong, because there is
 * nothing here for them to say.
 *
 * `on conflict (payment_id) do nothing` makes it idempotent against the unique
 * index rather than against a prior read: a replayed confirmation, a concurrent
 * one, or a second late-payment decision produces one debt.
 *
 * Returns the refund id when this call created it, undefined when one already
 * existed — so the caller can audit a creation without auditing a no-op.
 */
export async function recordRefundOwed(
  tx: Database,
  input: { orderId: string; paymentId: string; reason: string },
): Promise<string | undefined> {
  const id = uuidv7();
  const inserted = await tx.execute<{ [key: string]: unknown; id: string }>(sql`
    insert into refunds (id, order_id, payment_id, provider, status,
                         amount_minor, currency, reason)
    select ${id}, p.order_id, p.id, p.provider, 'owed',
           p.amount_minor, p.currency, ${input.reason}
      from payments p
     where p.id = ${input.paymentId}::uuid
       and p.order_id = ${input.orderId}::uuid
       -- A refund of a payment that did not succeed would be money we never
       -- received going back out. The condition is here rather than in a prior
       -- read so it holds under concurrency.
       and p.status = 'succeeded'
    on conflict (payment_id) do nothing
    returning id
  `);

  const created = inserted.rows[0]?.id;
  if (created === undefined) return undefined;

  await audit(tx, {
    actorKind: "system",
    action: "refund.owed_recorded",
    targetType: "refund",
    targetId: created,
    context: { orderId: input.orderId, paymentId: input.paymentId, reason: input.reason },
  });

  /*
   * The buyer is told a refund is owed, not that one has happened.
   *
   * Queued the moment the debt exists rather than when it is paid, because the
   * gap between the two is exactly when a buyer is wondering where their money
   * went. Nothing delivers this yet; see notifications/index.ts.
   */
  const buyer = await tx.execute<{ [key: string]: unknown; buyer_user_id: string }>(sql`
    select buyer_user_id from orders where id = ${input.orderId}::uuid
  `);
  const recipient = buyer.rows[0]?.buyer_user_id;
  if (recipient !== undefined) {
    await queueNotification(tx, {
      kind: "refund.owed",
      recipientUserId: recipient,
      subjectType: "refund",
      subjectId: created,
      payload: { orderId: input.orderId, reason: input.reason },
    });
  }

  return created;
}

/** One refund, for an operator who may read the queue. */
export async function findRefund(
  db: Database,
  actor: Actor,
  refundId: string,
): Promise<RefundRecord> {
  await authorize(db, actor, "refund.read");
  const rows = await db.execute<RefundRow>(sql`
    select ${REFUND_COLUMNS} from refunds where id = ${refundId}::uuid
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new RefundNotFoundError(refundId);
  return toRefund(row);
}

export interface RefundQueueEntry extends RefundRecord {
  readonly buyerUserId: string;
  readonly orderCurrency: string;
  readonly openAttempts: number;
}

/**
 * The operator queue, oldest first.
 *
 * Age-sorted rather than status-sorted, and that is a deliberate choice about
 * what an operator should see first. A refund owed for three days matters more
 * than one owed for three minutes whatever state either is in, and a queue
 * ordered by status quietly buries the oldest debt under whichever state the
 * ordering happens to favour.
 */
export async function listRefundQueue(
  db: Database,
  actor: Actor,
  options: { statuses?: readonly RefundState[]; limit?: number } = {},
): Promise<readonly RefundQueueEntry[]> {
  await authorize(db, actor, "refund.read");

  /*
   * The status filter is validated against the state list, not interpolated.
   *
   * These values reach SQL through `sql.raw` — Drizzle cannot parameterise an
   * IN list of unknown length — so they must be values this module chose, never
   * values a caller supplied. TypeScript says as much, but a value arriving
   * from JSON has no type at runtime, and "the types said so" is not a defence
   * against injection. Anything not in REFUND_STATES is dropped.
   */
  const requested = options.statuses ?? (["owed", "in_flight", "failed", "in_doubt"] as const);
  const statuses = REFUND_STATES.filter((s) => requested.includes(s));
  if (statuses.length === 0) return [];
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500);

  const rows = await db.execute<
    RefundRow & { buyer_user_id: string; order_currency: string; open_attempts: string | number }
  >(sql`
    select r.id, r.order_id, r.payment_id, r.provider, r.status, r.amount_minor, r.currency,
           r.reason, r.attempt_count, r.provider_refund_ref, r.resolved_by,
           r.resolution_evidence, r.requested_by_user_id, r.reconciliation_mode,
           r.not_before, r.created_at, r.resolved_at,
           o.buyer_user_id, o.currency as order_currency,
           (select count(*) from refund_attempts a
             where a.refund_id = r.id and a.finished_at is null) as open_attempts
      from refunds r join orders o on o.id = r.order_id
     where r.status in ${sql.raw(`(${statuses.map((s) => `'${s}'`).join(", ")})`)}
     order by r.created_at
     limit ${limit}
  `);

  return rows.rows.map((row) => ({
    ...toRefund(row),
    buyerUserId: row.buyer_user_id,
    orderCurrency: row.order_currency,
    openAttempts: Number(row.open_attempts),
  }));
}

/** The attempt history behind one refund. Evidence, so it is never summarised away. */
export interface RefundAttemptRecord {
  readonly id: string;
  readonly attemptNo: number;
  readonly idempotencyKey: string;
  readonly actorUserId: string | null;
  readonly actorKind: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly outcome: string | null;
  readonly stage: string | null;
  readonly providerRefundRef: string | null;
  readonly detail: string | null;
}

export async function listRefundAttempts(
  db: Database,
  actor: Actor,
  refundId: string,
): Promise<readonly RefundAttemptRecord[]> {
  await authorize(db, actor, "refund.read");
  const rows = await db.execute<{
    [key: string]: unknown;
    id: string;
    attempt_no: number;
    idempotency_key: string;
    actor_user_id: string | null;
    actor_kind: string;
    started_at: Date | string;
    finished_at: Date | string | null;
    outcome: string | null;
    stage: string | null;
    provider_refund_ref: string | null;
    detail: string | null;
  }>(sql`
    select id, attempt_no, idempotency_key, actor_user_id, actor_kind, started_at,
           finished_at, outcome, stage, provider_refund_ref, detail
      from refund_attempts where refund_id = ${refundId}::uuid
     order by attempt_no
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    attemptNo: Number(r.attempt_no),
    idempotencyKey: r.idempotency_key,
    actorUserId: r.actor_user_id,
    actorKind: r.actor_kind,
    startedAt: asDate(r.started_at) as Date,
    finishedAt: asDate(r.finished_at),
    outcome: r.outcome,
    stage: r.stage,
    providerRefundRef: r.provider_refund_ref,
    detail: r.detail,
  }));
}
