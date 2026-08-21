import { sql } from "drizzle-orm";
import {
  bigint, char, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { currencies } from "./reference";
import { orders, payments } from "./commerce";
import { users } from "./identity";

/**
 * Refund execution.
 *
 * Phase 2 could tell that a refund was owed — `orders.status = 'refund_due'` —
 * and could do nothing about it. This is the machinery that does something,
 * and its entire shape follows from one rule:
 *
 *     UNKNOWN MUST NEVER BECOME FAILED.
 *
 * A request that timed out, lost its connection, or answered 5xx after the
 * bytes left this process proves nothing about whether money moved. Those
 * become `in_doubt`, which can be resolved but never retried. Only a failure
 * proven to have never reached the provider — or a documented rejection
 * carrying evidence — becomes `failed`, and `failed` is the only state a retry
 * may leave from.
 *
 * Nothing here touches the ledger. Phase 2 posts no capture, so a reversal
 * would have nothing to reverse.
 */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    /**
     * UNIQUE. One payment, one refund — for all time, whatever races and
     * whatever crashes. This index is the outermost of the four layers that
     * stop a buyer being refunded twice.
     */
    paymentId: uuid("payment_id").notNull().references(() => payments.id),
    provider: text("provider").notNull(),
    /** owed | in_flight | succeeded | failed | in_doubt */
    status: text("status").notNull().default("owed"),
    /**
     * Copied from the payment at creation and never recomputed. Nothing in the
     * refund path performs arithmetic on it, so there is no place for a
     * minor-unit mistake — the XOF divide-by-100 — to enter.
     */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    /** Why a refund is owed, from the late-payment decision that produced it. */
    reason: text("reason").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    providerRefundRef: text("provider_refund_ref"),
    /** response | status_query | webhook | manual_reconciliation */
    resolvedBy: text("resolved_by"),
    /**
     * Required for `succeeded` AND for `failed`. Claiming a refund definitely
     * did not happen needs evidence exactly as much as claiming it did.
     */
    resolutionEvidence: text("resolution_evidence"),
    /** A retry before this instant is refused. */
    notBefore: timestamp("not_before", { withTimezone: true }),
    /** The finance user who authorised money leaving. NULL while merely owed. */
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id),
    reconciledByUserId: uuid("reconciled_by_user_id").references(() => users.id),
    reconciledConfirmedByUserId: uuid("reconciled_confirmed_by_user_id").references(() => users.id),
    /** two_person | single_operator */
    reconciliationMode: text("reconciliation_mode"),
    /**
     * A manual reconciliation in two steps: one person states what a provider
     * statement says, a different person confirms it before the refund moves.
     * Superseded rather than accumulated, so it lives here and not in a table.
     */
    proposedOutcome: text("proposed_outcome"),
    proposedEvidence: text("proposed_evidence"),
    proposedProviderRefundRef: text("proposed_provider_refund_ref"),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("refunds_payment_key").on(t.paymentId),
    uniqueIndex("refunds_order_key").on(t.orderId),
    index("refunds_queue_idx").on(t.status, t.createdAt),
    check(
      "refunds_status_valid",
      sql`${t.status} in ('owed','in_flight','succeeded','failed','in_doubt')`,
    ),
    check("refunds_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "refunds_succeeded_has_evidence",
      sql`${t.status} <> 'succeeded' or (${t.resolvedBy} is not null
           and ${t.resolutionEvidence} is not null
           and ${t.providerRefundRef} is not null
           and ${t.resolvedAt} is not null)`,
    ),
    check(
      "refunds_failed_has_evidence",
      sql`${t.status} <> 'failed' or (${t.resolvedBy} is not null and ${t.resolutionEvidence} is not null)`,
    ),
    check(
      "refunds_resolved_by_valid",
      sql`${t.resolvedBy} is null or ${t.resolvedBy} in ('response','status_query','webhook','manual_reconciliation')`,
    ),
    check(
      "refunds_reconciliation_mode_valid",
      sql`${t.reconciliationMode} is null or ${t.reconciliationMode} in ('two_person','single_operator')`,
    ),
    check(
      "refunds_two_person_is_two_people",
      sql`${t.reconciliationMode} <> 'two_person' or (
            ${t.reconciledByUserId} is not null
            and ${t.reconciledConfirmedByUserId} is not null
            and ${t.reconciledByUserId} <> ${t.reconciledConfirmedByUserId})`,
    ),
    check(
      "refunds_reconcilers_only_when_manual",
      sql`(${t.reconciledByUserId} is null and ${t.reconciledConfirmedByUserId} is null)
           or ${t.proposedOutcome} is not null
           or ${t.resolvedBy} = 'manual_reconciliation'
           or ${t.reconciliationMode} is not null`,
    ),
    check(
      "refunds_confirmer_needs_a_proposer",
      sql`${t.reconciledConfirmedByUserId} is null or ${t.reconciledByUserId} is not null`,
    ),
    check(
      "refunds_proposed_outcome_valid",
      sql`${t.proposedOutcome} is null or ${t.proposedOutcome} in ('succeeded','failed')`,
    ),
    check(
      "refunds_proposal_is_complete",
      sql`${t.proposedOutcome} is null or (${t.proposedEvidence} is not null
           and ${t.proposedAt} is not null and ${t.reconciledByUserId} is not null)`,
    ),
    check(
      "refunds_proposed_success_has_ref",
      sql`${t.proposedOutcome} <> 'succeeded' or ${t.proposedProviderRefundRef} is not null`,
    ),
  ],
);

/**
 * Every attempt to reach the provider, written BEFORE the request goes out.
 *
 * That ordering is the crash window's only defence. If this process dies
 * between the insert and the response, an open attempt row is what tells the
 * next operator that a request may be in flight. Writing it afterwards would
 * make a crash indistinguishable from a refund that was never attempted — and
 * "never attempted" is the reading that leads to a second refund.
 *
 * Append-only with exactly one permitted mutation: closing an open attempt. A
 * finished attempt is frozen and no attempt may ever be deleted; a database
 * trigger, not discipline, is what enforces that.
 */
export const refundAttempts = pgTable(
  "refund_attempts",
  {
    id: uuid("id").primaryKey(),
    refundId: uuid("refund_id").notNull().references(() => refunds.id),
    attemptNo: integer("attempt_no").notNull(),
    /** Derived — `refund:{refund_id}:{attempt_no}` — never supplied by a caller. */
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorKind: text("actor_kind").notNull().default("user"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** succeeded | failed | in_doubt | pending. NULL means still open. */
    outcome: text("outcome"),
    /**
     * not_transmitted | transmitted | unknown.
     *
     * THIS decides `failed` versus `in_doubt` — not the HTTP status, which
     * says nothing about whether the financial operation happened.
     */
    stage: text("stage"),
    providerRefundRef: text("provider_refund_ref"),
    /** Screened and truncated: a provider response is not trusted to be clean. */
    detail: text("detail"),
  },
  (t) => [
    uniqueIndex("refund_attempts_no_key").on(t.refundId, t.attemptNo),
    uniqueIndex("refund_attempts_idempotency_key").on(t.idempotencyKey),
    check("refund_attempts_no_positive", sql`${t.attemptNo} >= 1`),
    check(
      "refund_attempts_outcome_valid",
      sql`${t.outcome} is null or ${t.outcome} in ('succeeded','failed','in_doubt','pending')`,
    ),
    check(
      "refund_attempts_stage_valid",
      sql`${t.stage} is null or ${t.stage} in ('not_transmitted','transmitted','unknown')`,
    ),
    check(
      "refund_attempts_finished_is_classified",
      sql`${t.finishedAt} is null or (${t.outcome} is not null and ${t.stage} is not null)`,
    ),
    check(
      "refund_attempts_failed_means_not_transmitted",
      sql`${t.outcome} <> 'failed' or ${t.stage} = 'not_transmitted' or ${t.detail} is not null`,
    ),
  ],
);

/**
 * Things a person should be told, queued without a provider.
 *
 * No SMS provider has been chosen for Niger and none is invented here. A refund
 * resolution writes a ROW; delivery is a consumer that does not exist yet. That
 * is the whole point of an outbox — the domain stops at "this person should
 * know", and whichever provider is eventually chosen becomes a reader rather
 * than a redesign.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    /** Facts a renderer needs. Never a message body, never a credential. */
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    // One notification per event per subject: a retried resolution does not
    // produce a second message to the same person about the same thing.
    uniqueIndex("notification_outbox_event_key").on(t.kind, t.subjectType, t.subjectId),
    index("notification_outbox_pending_idx").on(t.status, t.createdAt),
    check(
      "notification_outbox_status_valid",
      sql`${t.status} in ('pending','sent','failed','abandoned')`,
    ),
    check(
      "notification_outbox_sent_has_timestamp",
      sql`${t.status} <> 'sent' or ${t.sentAt} is not null`,
    ),
  ],
);
