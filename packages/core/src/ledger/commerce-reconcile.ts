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
  | "duplicate_entitlement";

export interface CommerceAnomaly {
  readonly kind: CommerceAnomalyKind;
  readonly subject: string;
  readonly detail: string;
}

export interface CommerceReconciliationReport {
  readonly anomalies: readonly CommerceAnomaly[];
  readonly ordersChecked: number;
  readonly paymentsChecked: number;
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
  `);

  const counts = await db.execute<{ [key: string]: unknown; orders: string; payments: string }>(sql`
    select (select count(*) from orders) as orders,
           (select count(*) from payments) as payments
  `);

  return {
    anomalies: rows.rows.map((r) => ({
      kind: r.kind as CommerceAnomalyKind,
      subject: r.subject,
      detail: r.detail,
    })),
    ordersChecked: Number(counts.rows[0]?.orders ?? 0),
    paymentsChecked: Number(counts.rows[0]?.payments ?? 0),
  };
}

export function commerceIsClean(report: CommerceReconciliationReport): boolean {
  return report.anomalies.length === 0;
}
