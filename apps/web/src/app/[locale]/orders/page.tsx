import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { money as m, orders as ordersDomain } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import Link from "next/link";
import {
  Badge, buttonClass, EmptyState, PriceTag, SectionHeader, StoreTypeIcon, type BadgeTone,
} from "@afrinext/ui";
import { PageIntro } from "@/components/PageIntro";
import { Shell } from "@/components/Shell";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The buyer's own orders, and what those orders granted.
 *
 * Both lists are scoped to the actor in SQL. Nothing in the request names a
 * user, an order or an entitlement, so there is no id here that somebody could
 * change to read another person's purchases.
 *
 * The two sections answer two different questions and are labelled as such:
 * "what did I buy, and did it go through" (orders, with their state and
 * amount), and "what do I now have" (the entitlements those orders produced).
 * The second links into the library, which is the only screen that can
 * actually hand over a file — not back to the sales page, which would send
 * somebody who already paid to buy it again.
 */
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

  const dateOf = (at: Date): string =>
    new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
      day: "numeric", month: "short", year: "numeric",
    }).format(at);

  /*
   * What each state LOOKS like.
   *
   * `paid` is the acacia green and nothing else is — the colour means money
   * confirmed, so spending it on "pending" would make the one state a buyer
   * most wants to see indistinguishable from waiting. `refund_due` and the
   * failures are copper rather than red: a refund owed is not an error, it is
   * a queue with the buyer's money in it.
   */
  const toneOf = (status: string): BadgeTone =>
    status === "paid" ? "accent"
    : status === "refund_due" ? "copper"
    : "neutral";

  return (
    <>
      <PageIntro
        eyebrow={translate(locale, "order.eyebrow")}
        title={translate(locale, "order.myOrders")}
        {...(list.length > 0 ? { body: translate(locale, "order.ordersBody") } : {})}
      />

      <Shell width="wide">
        <div className="px-4 pt-6 sm:px-6">
          {list.length === 0 && owned.length === 0 ? (
            <EmptyState
              icon={<StoreTypeIcon type="digital_product" className="h-6 w-6" />}
              title={translate(locale, "order.emptyTitle")}
              body={translate(locale, "order.emptyBody")}
              action={
                <Link href={`/${locale}/explorer` as Route} className={buttonClass("solid", "lg")}>
                  {translate(locale, "order.emptyAction")}
                </Link>
              }
            />
          ) : (
            <>
              {list.length > 0 && (
                <section aria-labelledby="orders-heading">
                  <ul className="flex flex-col gap-2.5">
                    {list.map((order) => (
                      <li key={order.id}>
                        <Link
                          href={`/${locale}/orders/${order.id}` as Route}
                          className={
                            "flex items-center gap-4 rounded-[var(--radius-lg)] border " +
                            "border-border bg-surface p-4 transition-[border-color,box-shadow,transform] " +
                            "duration-[var(--duration-fast)] hover:border-border-strong " +
                            "hover:shadow-[var(--shadow-md)] active:scale-[0.995]"
                          }
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-h3 text-foreground">
                              {order.items[0]?.title ?? order.id.slice(0, 8)}
                            </p>
                            <p className="mt-1 text-caption text-muted">
                              {translate(locale, "order.placedOn", { date: dateOf(order.createdAt) })}
                            </p>
                            <div className="mt-2">
                              <Badge tone={toneOf(order.status)}>
                                {translate(locale, `order.status.${order.status}`)}
                              </Badge>
                            </div>
                          </div>
                          <PriceTag
                            amount={m.formatMoney(order.total, registry)}
                            size="md"
                            className="shrink-0 whitespace-nowrap"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <h2 id="orders-heading" className="sr-only">
                    {translate(locale, "order.myOrders")}
                  </h2>
                </section>
              )}

              {owned.length > 0 && (
                <section aria-labelledby="granted-heading" className="mt-10">
                  <SectionHeader
                    id="granted-heading"
                    title={translate(locale, "order.library")}
                    body={translate(locale, "order.libraryBody")}
                    action={
                      <Link
                        href={`/${locale}/library` as Route}
                        className={
                          "-my-2 -mr-2 inline-flex min-h-11 items-center rounded-[var(--radius-sm)] " +
                          "px-2 text-small font-semibold text-foreground underline-offset-4 " +
                          "transition-colors hover:bg-surface-muted hover:underline"
                        }
                      >
                        {translate(locale, "market.seeAll")}
                      </Link>
                    }
                  />
                  <ul data-testid="library" className="mt-4 flex flex-col gap-2">
                    {owned.map((item) => (
                      <li key={item.productId}>
                        {/* Into the library, not back to the sales page: this
                            is the screen that can actually hand over the file. */}
                        <a
                          data-testid={`library-${item.productSlug}`}
                          href={`/${locale}/library/${item.storeSlug}/${item.productSlug}`}
                          className={
                            "flex items-center gap-3 rounded-[var(--radius-md)] border " +
                            "border-border bg-surface p-3 transition-colors " +
                            "duration-[var(--duration-fast)] hover:border-border-strong " +
                            "hover:bg-surface-muted"
                          }
                        >
                          <span
                            aria-hidden="true"
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-ink text-[var(--on-ink)]"
                          >
                            <StoreTypeIcon type="digital_product" className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-small font-semibold text-foreground">
                            {item.title}
                          </span>
                          <span className="shrink-0 text-caption font-medium text-copper">
                            {translate(locale, "library.openProduct")}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </Shell>
    </>
  );
}
