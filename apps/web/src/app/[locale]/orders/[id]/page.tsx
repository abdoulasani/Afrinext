import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { money as m, orders as ordersDomain } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import PayButton from "@/components/PayButton";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * One order, for the person who placed it.
 *
 * `findOwnOrder` scopes to the actor in SQL, so another buyer's order id is not
 * "found then refused" — it is not found, and this page renders a 404 for it.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const order = await ordersDomain.findOwnOrder(getDb(), actor, id).catch(() => undefined);
  if (order === undefined) notFound();

  const registry = await currencyRegistry();
  const statusLabel = translate(locale, `order.status.${order.status}`);

  return (
    <>
      <AppHeader title={translate(locale, "order.title")} back={`/${locale}/orders` as Route} />
      <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
        <section className="flex flex-col gap-1">
          <p data-testid="order-status" className="text-xs uppercase tracking-wide text-muted">
            {statusLabel}
          </p>
          <p data-testid="order-total" className="text-3xl font-semibold tabular-nums">
            {m.formatMoney(order.total, registry)}
          </p>
        </section>

        <ul className="flex flex-col gap-2">
          {order.items.map((item) => (
            <li
              key={item.productId}
              className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2"
            >
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-sm tabular-nums text-muted">
                {item.quantity} × {m.formatMoney(item.unitPrice, registry)}
              </span>
            </li>
          ))}
        </ul>

        {order.status === "pending_payment" && (
          <section className="flex flex-col gap-2 border-t border-border pt-5">
            <PayButton
              locale={locale}
              orderId={order.id}
              label={translate(locale, "order.pay")}
              waiting={translate(locale, "order.awaiting")}
            />
          </section>
        )}

        {order.status === "refund_due" && (
          <section className="flex flex-col gap-2 border-t border-border pt-5">
            {/*
              * Said plainly, and NOT as a completed refund.
              *
              * The money reached the provider and Afrinext did not deliver. The
              * order is queued for a refund that has not been executed — saying
              * anything warmer than that would be telling the buyer their money
              * is on its way when no code sends it.
              */}
            <p data-testid="order-refund-due" className="text-sm font-medium">
              {translate(locale, "order.refundDueExplain")}
            </p>
            <p className="text-xs text-muted">
              {translate(locale, "order.refundNotYetExecuted")}
            </p>
          </section>
        )}

        {order.status === "paid" && (
          <section className="flex flex-col gap-2 border-t border-border pt-5">
            <p data-testid="order-paid" className="text-sm font-medium">
              {translate(locale, "order.paidExplain")}
            </p>
            {/*
              * Said plainly on the screen, because it is true: the provider has
              * confirmed, and the seller has not been settled. No screen in
              * Afrinext describes an entitlement as money held for someone.
              */}
            <p className="text-xs text-muted">{translate(locale, "order.notSettled")}</p>
            <a
              href={`/${locale}/orders`}
              className="w-full rounded-full bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-contrast"
            >
              {translate(locale, "order.openLibrary")}
            </a>
          </section>
        )}
      </div>
    </>
  );
}
