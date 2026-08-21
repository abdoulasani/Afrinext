import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";

/**
 * Commerce reconciliation: the states the order and payment machines say are
 * impossible, looked for anyway.
 *
 * Ledger reconciliation asks whether the books balance. It cannot ask whether a
 * payment that succeeded left an order somewhere sensible, because it knows
 * nothing about orders — and that gap is exactly how a confirmed payment sat
 * against an expired order with nothing anywhere reporting it.
 *
 * Every check here is a query for a state the domain is supposed to make
 * unreachable. In a healthy system all of them return nothing, which is the
 * point: this is a smoke detector, not a report. CI asserts it is silent, so a
 * future change that quietly reopens one of these gaps fails the build rather
 * than the month-end.
 */

export type CommerceAnomalyKind =
  | "succeeded_payment_orphaned"
  | "paid_order_without_payment"
  | "multiple_succeeded_payments"
  | "refund_due_without_payment"
  | "duplicate_entitlement"
  // Phase 3 — refund execution. Each of these is a state the refund machine
  // says is impossible, looked for anyway.
  | "refund_due_without_refund_record"
  | "refund_without_refund_due_order"
  | "refund_of_unsucceeded_payment"
  | "refund_amount_mismatch"
  | "multiple_refunds_for_payment"
  | "refund_succeeded_without_evidence"
  | "refund_failed_without_evidence"
  | "stuck_in_flight"
  | "refund_attempt_never_finished"
  | "manual_reconciliation_single_operator";

export interface CommerceAnomaly {
  readonly kind: CommerceAnomalyKind;
  readonly subject: string;
  readonly detail: string;
}

export interface CommerceReconciliationReport {
  readonly anomalies: readonly CommerceAnomaly[];
  readonly ordersChecked: number;
  readonly paymentsChecked: number;
  readonly refundsChecked: number;
}

export async function reconcileCommerce(db: Database): Promise<CommerceReconciliationReport> {
  const rows = await db.execute<{
    [key: string]: unknown;
    kind: string;
    subject: string;
    detail: string;
  }>(sql`
    -- 1. A payment succeeded and its order is neither paid nor queued for a
    --    refund. This is the case the review gate was opened for: money that
    --    arrived and left no commercial trace.
    select 'succeeded_payment_orphaned' as kind,
           p.id::text as subject,
           'order ' || o.id::text || ' is ' || o.status as detail
      from payments p join orders o on o.id = p.order_id
     where p.status = 'succeeded' and o.status not in ('paid', 'refund_due')

    union all
    -- 2. An order says it was paid and no payment agrees. Fulfilment without
    --    money is the mirror image, and worse for the seller.
    select 'paid_order_without_payment', o.id::text,
           'no succeeded payment for a paid order'
      from orders o
     where o.status = 'paid'
       and not exists (
         select 1 from payments p where p.order_id = o.id and p.status = 'succeeded')

    union all
    -- 3. Two successful payments for one order: the buyer was charged twice.
    --    A partial unique index permits only one LIVE attempt, which does not
    --    bound how many may have succeeded over time.
    select 'multiple_succeeded_payments', o.id::text,
           count(*)::text || ' succeeded payments'
      from orders o join payments p on p.order_id = o.id
     where p.status = 'succeeded'
     group by o.id
    having count(*) > 1

    union all
    -- 4. An order queued for a refund with no payment to refund. Either the
    --    queue is wrong or the payment record is.
    select 'refund_due_without_payment', o.id::text,
           'refund_due with no succeeded payment'
      from orders o
     where o.status = 'refund_due'
       and not exists (
         select 1 from payments p where p.order_id = o.id and p.status = 'succeeded')

    union all
    -- 5. Two entitlements for one buyer and one product. A unique index makes
    --    this unreachable today; the check is what notices if that index is
    --    ever dropped, which is the kind of change that looks harmless.
    select 'duplicate_entitlement', e.user_id::text || ':' || e.product_id::text,
           count(*)::text || ' grants'
      from entitlements e
     group by e.user_id, e.product_id
    having count(*) > 1

    -- -----------------------------------------------------------------------
    -- Refund execution
    -- -----------------------------------------------------------------------

    union all
    -- 6. A refund is owed and no refund record exists. This is the queue
    --    starving: the money is owed, and nothing anywhere is tracking it.
    select 'refund_due_without_refund_record', o.id::text,
           'order is refund_due with no refunds row'
      from orders o
     where o.status = 'refund_due'
       and not exists (select 1 from refunds r where r.order_id = o.id)

    union all
    -- 7. The mirror: a refund exists for an order that is not refund_due.
    --    Either the refund is spurious or an order changed underneath it.
    select 'refund_without_refund_due_order', r.id::text,
           'refund exists but order ' || o.id::text || ' is ' || o.status
      from refunds r join orders o on o.id = r.order_id
     where o.status <> 'refund_due'

    union all
    -- 8. A refund against a payment that never succeeded — money going back
    --    out that never came in.
    select 'refund_of_unsucceeded_payment', r.id::text,
           'payment ' || p.id::text || ' is ' || p.status
      from refunds r join payments p on p.id = r.payment_id
     where p.status <> 'succeeded'

    union all
    -- 9. The frozen amount stopped agreeing with its source. A direct row edit
    --    is the only way to reach this, which is exactly why it is checked.
    select 'refund_amount_mismatch', r.id::text,
           'refund ' || r.amount_minor::text || r.currency ||
           ' vs payment ' || p.amount_minor::text || p.currency
      from refunds r join payments p on p.id = r.payment_id
     where r.amount_minor <> p.amount_minor or r.currency <> p.currency

    union all
    -- 10. Two refunds for one payment: the buyer was refunded twice. A unique
    --     index makes this unreachable; the detector is what notices if the
    --     index is ever dropped.
    select 'multiple_refunds_for_payment', r.payment_id::text,
           count(*)::text || ' refunds'
      from refunds r
     group by r.payment_id
    having count(*) > 1

    union all
    -- 11. A refund claiming money went back without saying how it knows. A
    --     CHECK constraint refuses this; the detector survives the constraint.
    select 'refund_succeeded_without_evidence', r.id::text,
           'succeeded with no resolution evidence or provider reference'
      from refunds r
     where r.status = 'succeeded'
       and (r.resolved_by is null or r.resolution_evidence is null
            or r.provider_refund_ref is null)

    union all
    -- 12. And the half that matters just as much: a refund claiming money
    --     definitely did NOT go back, with nothing behind the claim. That is
    --     an unknown wearing a failure's clothes, and it is retryable.
    select 'refund_failed_without_evidence', r.id::text,
           'failed with no resolution evidence'
      from refunds r
     where r.status = 'failed'
       and (r.resolved_by is null or r.resolution_evidence is null)

    union all
    -- 13. A request that has been out for over an hour. The sweeper should
    --     have moved it to in_doubt long before this.
    select 'stuck_in_flight', r.id::text,
           'in_flight since ' || r.updated_at::text
      from refunds r
     where r.status = 'in_flight'
       and r.updated_at <= now() - interval '1 hour'

    union all
    -- 14. An attempt row nobody ever closed while the refund moved on. The
    --     evidence and the state disagree, which makes the evidence useless.
    select 'refund_attempt_never_finished', a.id::text,
           'attempt ' || a.attempt_no::text || ' open while refund is ' || r.status
      from refund_attempts a join refunds r on r.id = a.refund_id
     where a.finished_at is null and r.status <> 'in_flight'

    union all
    -- 15. A refund resolved by one person acting alone. Not necessarily wrong
    --     — it is the approved fallback for a deployment with one finance user
    --     — but it is the weakest control in the system, so it is counted and
    --     surfaced rather than being invisible.
    select 'manual_reconciliation_single_operator', r.id::text,
           'resolved to ' || r.status || ' by a single operator'
      from refunds r
     where r.reconciliation_mode = 'single_operator'
  `);

  const counts = await db.execute<{
    [key: string]: unknown; orders: string; payments: string; refunds: string;
  }>(sql`
    select (select count(*) from orders) as orders,
           (select count(*) from payments) as payments,
           (select count(*) from refunds) as refunds
  `);

  return {
    anomalies: rows.rows.map((r) => ({
      kind: r.kind as CommerceAnomalyKind,
      subject: r.subject,
      detail: r.detail,
    })),
    ordersChecked: Number(counts.rows[0]?.orders ?? 0),
    paymentsChecked: Number(counts.rows[0]?.payments ?? 0),
    refundsChecked: Number(counts.rows[0]?.refunds ?? 0),
  };
}

export function commerceIsClean(report: CommerceReconciliationReport): boolean {
  return report.anomalies.length === 0;
}
