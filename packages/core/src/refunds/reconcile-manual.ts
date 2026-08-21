import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { requireElevation } from "../auth/session-bridge";
import { authorize, type Actor } from "../authz";
import { DomainError } from "../errors";
import { queueNotification } from "../notifications";
import { screenDetail } from "../payments";
import { REFUND_COLUMNS, RefundNotFoundError, toRefund, type RefundRow } from "./record";
import { assertRefundTransition, type RefundState } from "./state";

/**
 * Manual reconciliation: a person stating what a provider statement says.
 *
 * This is the escape hatch for a refund the machinery cannot resolve — the
 * provider has no status query, or has one and cannot answer, and somebody has
 * to read a statement and say what happened. It is therefore the single most
 * dangerous operation in the phase, because it is the only place where a
 * human's word becomes financial truth.
 *
 * So it is deliberately NOT a button that says "mark as refunded". Four things
 * stand between an operator and a fabricated success:
 *
 *   1. An EXTERNAL REFERENCE is required for a success. Claiming money went
 *      back means naming what the provider calls the refund, which is a claim
 *      that can be checked against the provider's own records later.
 *   2. STEP-UP ELEVATION. Holding the permission says they are allowed in
 *      principle; elevation says they are present right now.
 *   3. TWO PEOPLE, where the deployment has two people. One proposes what the
 *      statement says, a DIFFERENT one confirms it. Neither half moves money
 *      alone.
 *   4. A DISTINCT RESOLUTION SOURCE. `manual_reconciliation` is its own value,
 *      so every refund resolved this way can be listed, counted, and re-audited
 *      against a provider statement by somebody who was not involved.
 *
 * On the third: the requirement adapts, and the reason is honesty rather than
 * convenience. Afrinext is one person's company today. A dual-control rule that
 * literally cannot be satisfied is not a control — it is a rule people work
 * around, usually by sharing a login, which is worse than no rule. So the
 * confirmer must be a different person WHENEVER a different person holds the
 * permission, and when exactly one holder exists the resolution is recorded as
 * `single_operator` — visible, countable, and flagged by reconciliation, rather
 * than silently identical to dual control.
 *
 * That adaptation is not a hole an operator can open: the number of holders is
 * counted in SQL at the moment of confirmation, and changing it requires
 * `admin.role.grant`, which finance deliberately does not hold.
 */

export class ManualReconciliationError extends DomainError {
  override readonly name = "ManualReconciliationError";
  constructor(code: string, why: string) {
    super(code, why);
  }
}

export interface ProposeReconciliationInput {
  readonly refundId: string;
  /** What the provider statement says happened. */
  readonly outcome: "succeeded" | "failed";
  /** The provider's own reference. Required to claim a success. */
  readonly providerRefundRef?: string | undefined;
  /** What was read, and where. Stored verbatim after screening. */
  readonly evidence: string;
}

export interface ReconciliationState {
  readonly refundId: string;
  readonly status: RefundState;
  readonly proposedOutcome: "succeeded" | "failed" | null;
  readonly proposedBy: string | null;
  readonly confirmedBy: string | null;
  readonly mode: "two_person" | "single_operator" | null;
  /** How many distinct people could confirm. Drives the dual-control rule. */
  readonly eligibleConfirmers: number;
}

/**
 * How many DIFFERENT people hold `refund.reconcile_manual` globally.
 *
 * Counted from live role assignments rather than from a setting, so the rule
 * follows the deployment's actual staffing. A revoked assignment does not
 * count; a role granted in a non-global scope does not count, because manual
 * reconciliation is a global capability.
 */
export async function countManualReconcilers(db: Database): Promise<number> {
  const rows = await db.execute<{ [key: string]: unknown; n: string | number }>(sql`
    select count(distinct ra.user_id) as n
      from role_assignments ra
      join roles r on r.id = ra.role_id
      join role_permissions rp on rp.role_id = r.id
     where rp.permission_key = 'refund.reconcile_manual'
       and ra.revoked_at is null
       and ra.scope_type = 'global'
  `);
  return Number(rows.rows[0]?.n ?? 0);
}

async function loadForReconciliation(db: Database, refundId: string) {
  const rows = await db.execute<
    RefundRow & {
      proposed_outcome: string | null;
      proposed_evidence: string | null;
      proposed_provider_refund_ref: string | null;
      reconciled_by_user_id: string | null;
      reconciled_confirmed_by_user_id: string | null;
      buyer_user_id: string;
    }
  >(sql`
    select ${REFUND_COLUMNS}, refunds.proposed_outcome, refunds.proposed_evidence,
           refunds.proposed_provider_refund_ref, refunds.reconciled_by_user_id,
           refunds.reconciled_confirmed_by_user_id, o.buyer_user_id
      from refunds join orders o on o.id = refunds.order_id
     where refunds.id = ${refundId}::uuid
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new RefundNotFoundError(refundId);
  return { row, refund: toRefund(row) };
}

/**
 * Step one: state what the provider statement says. Moves no money and no state.
 *
 * A proposal is a claim awaiting a second person, so this deliberately changes
 * nothing about the refund except that a claim now exists against it. A
 * proposal can be replaced by a later proposal — a first reading can be wrong —
 * and each replacement is audited, so "the proposal changed after somebody
 * queried it" is visible rather than invisible.
 */
export async function proposeManualReconciliation(
  db: Database,
  actor: Actor,
  input: ProposeReconciliationInput,
): Promise<ReconciliationState> {
  await authorize(db, actor, "refund.reconcile_manual");
  requireElevation(actor, "refund.reconcile_manual");

  const { refund } = await loadForReconciliation(db, input.refundId);

  if (refund.status !== "in_doubt") {
    throw new ManualReconciliationError(
      "refund.not_reconcilable",
      "Only a refund of unknown outcome is reconciled by hand. This one is " +
        `${refund.status}, and the machinery already knows what happened.`,
    );
  }
  const evidence = input.evidence.trim();
  if (evidence === "") {
    throw new ManualReconciliationError(
      "refund.evidence_required",
      "State what the provider's records say and where you read it. A " +
        "reconciliation without evidence is an assertion, not a reconciliation.",
    );
  }
  const providerRef = input.providerRefundRef?.trim() ?? "";
  if (input.outcome === "succeeded" && providerRef === "") {
    throw new ManualReconciliationError(
      "refund.reference_required",
      "Claiming a refund succeeded means naming the reference the provider " +
        "knows it by, so somebody else can check the claim against the provider.",
    );
  }

  const screened = screenDetail(evidence);

  await db.execute(sql`
    update refunds
       set proposed_outcome = ${input.outcome},
           proposed_evidence = ${screened},
           proposed_provider_refund_ref = ${providerRef === "" ? null : providerRef},
           proposed_at = now(),
           reconciled_by_user_id = ${actor.userId}::uuid,
           -- A new proposal clears any prior confirmation: the second person
           -- confirmed the OLD statement, not this one.
           reconciled_confirmed_by_user_id = null,
           updated_at = now()
     where id = ${refund.id}::uuid and status = 'in_doubt'
  `);

  await audit(db, {
    actorKind: "user",
    actorUserId: actor.userId,
    action: "refund.manual_reconciliation_proposed",
    targetType: "refund",
    targetId: refund.id,
    context: {
      outcome: input.outcome,
      providerRefundRef: providerRef === "" ? null : providerRef,
      evidence: screened,
    },
  });

  return reconciliationState(db, refund.id);
}

/**
 * Step two: a second person confirms, and the refund moves.
 *
 * The dual-control check is a comparison of user ids, made here, against a
 * count taken here. When two or more people can confirm, the confirmer must not
 * be the proposer — full stop, no override parameter, no "force" flag. When one
 * person is all there is, the same person may confirm and the row records
 * `single_operator` so that fact is countable.
 *
 * A confirmation to `succeeded` is terminal and irreversible, which is why it
 * writes the external reference into `provider_refund_ref`: the database's own
 * CHECK refuses a succeeded refund that does not name one.
 */
export async function confirmManualReconciliation(
  db: Database,
  actor: Actor,
  refundId: string,
): Promise<ReconciliationState> {
  await authorize(db, actor, "refund.reconcile_manual");
  requireElevation(actor, "refund.reconcile_manual");

  const { row, refund } = await loadForReconciliation(db, refundId);

  if (refund.status !== "in_doubt") {
    throw new ManualReconciliationError(
      "refund.not_reconcilable",
      `This refund is ${refund.status} and is no longer awaiting a decision.`,
    );
  }
  const proposedOutcome = row.proposed_outcome;
  const proposer = row.reconciled_by_user_id;
  if (proposedOutcome === null || proposer === null) {
    throw new ManualReconciliationError(
      "refund.no_proposal",
      "There is nothing to confirm. Somebody must first state what the " +
        "provider's records say.",
    );
  }

  const eligible = await countManualReconcilers(db);
  const samePerson = proposer === actor.userId;

  if (samePerson && eligible > 1) {
    throw new ManualReconciliationError(
      "refund.second_person_required",
      "Another person who can reconcile refunds must confirm this. You proposed " +
        "it, so you may not also confirm it.",
    );
  }

  const mode = samePerson ? "single_operator" : "two_person";
  const to: RefundState = proposedOutcome === "succeeded" ? "succeeded" : "failed";
  assertRefundTransition("in_doubt", to);

  const evidenceText =
    `manual reconciliation (${mode}): ${row.proposed_evidence ?? ""}`.trim();

  const moved = await db.transaction(async (tx) => {
    // Any attempt still open ends here: a person has established the outcome.
    await tx.execute(sql`
      update refund_attempts
         set finished_at = now(), outcome = ${to}, stage = 'unknown',
             detail = ${evidenceText}
       where refund_id = ${refundId}::uuid and finished_at is null
    `);

    const result = await tx.execute(sql`
      update refunds
         set status = ${to},
             resolved_by = 'manual_reconciliation',
             resolution_evidence = ${evidenceText},
             provider_refund_ref =
               coalesce(${row.proposed_provider_refund_ref}, provider_refund_ref),
             resolved_at = case when ${to === "succeeded"} then now() else resolved_at end,
             reconciled_confirmed_by_user_id = ${actor.userId}::uuid,
             reconciliation_mode = ${mode},
             updated_at = now()
       where id = ${refundId}::uuid and status = 'in_doubt'
    `);
    if ((result.rowCount ?? 0) === 0) return false;

    await audit(tx, {
      actorKind: "user",
      actorUserId: actor.userId,
      action: "refund.manual_reconciliation_confirmed",
      targetType: "refund",
      targetId: refundId,
      context: {
        outcome: to,
        mode,
        proposedBy: proposer,
        confirmedBy: actor.userId,
        eligibleConfirmers: eligible,
        providerRefundRef: row.proposed_provider_refund_ref,
        evidence: row.proposed_evidence,
      },
    });

    await queueNotification(tx, {
      kind: to === "succeeded" ? "refund.succeeded" : "refund.failed",
      recipientUserId: row.buyer_user_id,
      subjectType: "refund",
      subjectId: refundId,
      payload: { outcome: to, resolvedBy: "manual_reconciliation" },
    });
    return true;
  });

  if (!moved) {
    throw new ManualReconciliationError(
      "refund.raced",
      "This refund changed while you were confirming it. Look at it again.",
    );
  }

  return reconciliationState(db, refundId);
}

export async function reconciliationState(
  db: Database,
  refundId: string,
): Promise<ReconciliationState> {
  const rows = await db.execute<{
    [key: string]: unknown;
    status: string;
    proposed_outcome: string | null;
    reconciled_by_user_id: string | null;
    reconciled_confirmed_by_user_id: string | null;
    reconciliation_mode: string | null;
  }>(sql`
    select status, proposed_outcome, reconciled_by_user_id,
           reconciled_confirmed_by_user_id, reconciliation_mode
      from refunds where id = ${refundId}::uuid
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new RefundNotFoundError(refundId);

  return {
    refundId,
    status: row.status as RefundState,
    proposedOutcome: row.proposed_outcome as "succeeded" | "failed" | null,
    proposedBy: row.reconciled_by_user_id,
    confirmedBy: row.reconciled_confirmed_by_user_id,
    mode: row.reconciliation_mode as "two_person" | "single_operator" | null,
    eligibleConfirmers: await countManualReconcilers(db),
  };
}
