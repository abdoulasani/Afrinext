import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { money as m, orders as ordersDomain } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The buyer's own orders, and what those orders granted. */
export default async function OrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const db = getDb();
  const [list, owned, registry] = await Promise.all([
    ordersDomain.listOwnOrders(db, actor),
    ordersDomain.listOwnEntitlements(db, actor),
    currencyRegistry(),
  ]);

  return (
    <>
      <AppHeader title={translate(locale, "order.myOrders")} back={`/${locale}/wallet` as Route} />
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide text-muted">
            {translate(locale, "order.library")}
          </h2>
          {owned.length === 0 ? (
            <p className="text-sm text-muted">{translate(locale, "order.libraryEmpty")}</p>
          ) : (
            <ul data-testid="library" className="flex flex-col gap-2">
              {owned.map((item) => (
                <li key={item.productId} className="rounded-xl bg-surface-muted px-3 py-2">
                  {/* Into the library, not back to the sales page: this is the
                      screen that can actually hand over the file. */}
                  <a
                    className="text-sm font-medium"
                    data-testid={`library-${item.productSlug}`}
                    href={`/${locale}/library/${item.storeSlug}/${item.productSlug}`}
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-border pt-5">
          <h2 className="text-xs uppercase tracking-wide text-muted">
            {translate(locale, "order.myOrders")}
          </h2>
          {list.length === 0 ? (
            <p className="text-sm text-muted">{translate(locale, "order.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((order) => (
                <li key={order.id}>
                  <a
                    href={`/${locale}/orders/${order.id}`}
                    className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2"
                  >
                    <span className="text-sm font-medium">
                      {order.items[0]?.title ?? order.id.slice(0, 8)}
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {m.formatMoney(order.total, registry)} ·{" "}
                      {translate(locale, `order.status.${order.status}`)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
