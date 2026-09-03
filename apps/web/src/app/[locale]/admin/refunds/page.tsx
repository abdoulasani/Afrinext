import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { authz, money as m, refunds as refundsDomain } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import { currentActor } from "@/lib/session";
import RefundActions from "./RefundActions";

export const dynamic = "force-dynamic";

/**
 * The refund queue an operator actually looks at.
 *
 * Three things about it are decisions rather than styling.
 *
 * AGE-SORTED, not status-sorted. A refund owed for three days matters more
 * than one owed for three minutes whatever state either is in, and ordering by
 * status quietly buries the oldest debt under whichever state the sort favours.
 *
 * `in_doubt` IS NOT A FAILURE, and the screen says so in words. An operator who
 * reads "unknown" as "it didn't work" will look for a retry button, so the
 * explanation sits next to the state rather than in a manual nobody opens.
 *
 * THERE IS NO "MARK AS REFUNDED" BUTTON. Not hidden behind a permission, not
 * disabled — absent. Resolving an unknown goes through a provider query, a
 * webhook, or a two-person reconciliation that requires an external reference.
 * The database refuses a succeeded refund with no evidence, so the button could
 * not have worked even if somebody added it.
 */
export default async function AdminRefundsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  // typedRoutes cannot expand a computed dynamic segment, so the cast is
  // explicit rather than the whole check being switched off.
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const db = getDb();
  /*
   * The gate is `refund.read`, checked here AND inside `listRefundQueue`.
   *
   * This one renders a message instead of a queue; the domain one is what
   * actually protects the data, and it is the reason a direct call to the API
   * route by somebody who never loaded this page gets nothing either.
   */
  if (!(await authz.can(db, actor, "refund.read"))) {
    return (
      <>
        <AppHeader title={translate(locale, "refund.queue")} />
        <p className="px-4 py-8 text-sm text-muted">
          {translate(locale, "error.permissionDenied")}
        </p>
      </>
    );
  }

  const currencyRows = await db.execute<{ code: string; minor_unit: number }>(
    sql`select code, minor_unit from currencies`,
  );
  const registry = m.createCurrencyRegistry(
    currencyRows.rows.map((r) => ({ code: r.code, minorUnit: Number(r.minor_unit) })),
  );

  const queue = await refundsDomain.listRefundQueue(db, actor, {
    statuses: ["owed", "in_flight", "failed", "in_doubt", "succeeded"],
    limit: 100,
  });

  // What this operator may DO, resolved once and passed down. The buttons a
  // page renders are a convenience; the domain decides whether they work.
  const mayExecute = await authz.can(db, actor, "refund.execute");
  const mayReconcile = await authz.can(db, actor, "refund.reconcile_manual");

  /*
   * Colour comes from the token palette in packages/ui/src/tokens.css, and the
   * palette has no "warning" or "danger". That is not a gap to work around
   * with a hex value: `accent` is the emphasis colour that exists, and an
   * unknown outcome is emphasised rather than coloured like an error, because
   * an unknown is not an error. `in_doubt` painted red would teach operators
   * to read it as failure, which is the exact misreading the phase is built to
   * prevent.
   */
  const badge = (status: string) => {
    const tone =
      status === "succeeded" ? "bg-primary-soft text-primary"
      : status === "in_doubt" ? "bg-accent-soft text-accent"
      : status === "failed" ? "bg-surface-muted text-foreground"
      : "bg-surface-muted text-muted";
    return (
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
        {translate(locale, `refund.status.${status}` as "refund.status.owed")}
      </span>
    );
  };

  return (
    <>
      <AppHeader title={translate(locale, "refund.queue")} subtitle={locale.toUpperCase()} />

      <p className="px-4 pt-3 text-xs text-muted">{translate(locale, "refund.noLedgerYet")}</p>

      {queue.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted">{translate(locale, "refund.queueEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="refund-queue">
          {queue.map((refund) => (
            <li key={refund.id} className="px-4 py-4" data-testid={`refund-${refund.id}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-base" data-testid="refund-amount">
                  {m.formatMoney(refund.amount, registry)}
                </span>
                <span data-testid="refund-status" data-status={refund.status}>
                  {badge(refund.status)}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
                <dt>{translate(locale, "refund.reason")}</dt>
                <dd className="font-mono">{refund.reason}</dd>
                <dt>{translate(locale, "refund.owedSince")}</dt>
                <dd>{refund.createdAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
                <dt>{translate(locale, "refund.attempts")}</dt>
                <dd data-testid="refund-attempts">{refund.attemptCount}</dd>
                {refund.providerRefundRef !== null && (
                  <>
                    <dt>{translate(locale, "refund.providerRef")}</dt>
                    <dd className="font-mono break-all">{refund.providerRefundRef}</dd>
                  </>
                )}
                {refund.resolvedBy !== null && (
                  <>
                    <dt>{translate(locale, "refund.resolvedBy")}</dt>
                    <dd className="font-mono">{refund.resolvedBy}</dd>
                  </>
                )}
              </dl>

              {refund.status === "in_doubt" && (
                <p className="mt-2 rounded bg-accent-soft px-2 py-1.5 text-xs text-accent"
                   data-testid="in-doubt-explainer">
                  {translate(locale, "refund.inDoubtExplain")}
                </p>
              )}

              {refund.reconciliationMode === "single_operator" && (
                <p className="mt-2 text-xs text-accent">
                  {translate(locale, "refund.singleOperator")}
                </p>
              )}

              <RefundActions
                refundId={refund.id}
                status={refund.status}
                mayExecute={mayExecute}
                mayReconcile={mayReconcile}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="px-4 pb-8 pt-4 text-xs text-muted">
        {translate(locale, "refund.notDelivered")}
      </p>
    </>
  );
}
