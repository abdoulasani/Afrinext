import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { content, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { Badge, buttonClass, Card, EmptyState, StoreTypeIcon } from "@afrinext/ui";
import AppHeader from "@/components/AppHeader";
import { Shell } from "@/components/Shell";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * What this person owns.
 *
 * Every row comes from `listEntitledProducts`, which joins from the session's
 * actor through a live entitlement. There is no user id, order id or "owned"
 * flag in the request, and nothing is read from the browser — so the only way
 * a product appears here is that this person actually paid for it and has not
 * been refunded.
 *
 * What each row shows is the truth about the purchase rather than the product's
 * current state: the version bought, the licence agreed to, and how many
 * downloads remain. A seller publishing version 2 tomorrow does not change any
 * of it.
 */
export default async function LibraryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const db = getDb();
  const [owned, registry] = await Promise.all([
    content.listEntitledProducts(db, actor).catch(() => []),
    currencyRegistry(),
  ]);

  const dateOf = (at: Date): string =>
    new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
      day: "numeric", month: "long", year: "numeric",
    }).format(at);

  return (
    <>
      <AppHeader title={translate(locale, "library.title")} />
      <Shell width="wide">
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-5">
          {owned.length === 0 ? (
            <EmptyState
              icon={<StoreTypeIcon type="digital_product" className="h-6 w-6" />}
              title={translate(locale, "library.emptyTitle")}
              body={translate(locale, "library.emptyBody")}
              action={
                <Link href={`/${locale}/explorer` as Route} className={buttonClass("primary", "lg")}>
                  {translate(locale, "library.emptyAction")}
                </Link>
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {owned.map((item) => (
                <Card as="li" key={item.productId} interactive data-testid="library-item">
                  <Link
                    href={`/${locale}/library/${item.storeSlug}/${item.productSlug}` as Route}
                    className="flex h-full flex-col gap-2.5 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-[15px] font-semibold leading-snug text-foreground">
                        {item.title}
                      </h2>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone="neutral">
                          {translate(locale, "library.version", { n: item.versionNo })}
                        </Badge>
                        {/*
                          * A fact about the product, not a promise about this
                          * purchase. The card only flags that one exists; the
                          * product page explains what it does and does not mean.
                          */}
                        {item.latestVersionNo > item.versionNo && (
                          <span
                            data-testid="library-newer"
                            className="text-[11px] font-medium text-muted"
                          >
                            {translate(locale, "library.newerVersion", {
                              n: item.latestVersionNo,
                            })}
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-[13px] text-muted">{item.storeName}</p>

                    <dl className="mt-auto flex flex-col gap-1 pt-1 text-[12px] text-muted">
                      <div className="flex justify-between gap-3">
                        <dt className="sr-only">{translate(locale, "library.since", { date: "" })}</dt>
                        <dd>{translate(locale, "library.since", { date: dateOf(item.grantedAt) })}</dd>
                        <dd className="font-semibold tabular-nums text-primary">
                          {m.formatMoney(item.price, registry)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <dd>{translate(locale, "library.files", { count: item.assetCount })}</dd>
                        {/*
                          * The limit, stated on the card so a buyer knows before
                          * they click. `null` is genuinely unlimited and says so
                          * rather than showing an invented number.
                          */}
                        <dd data-testid="library-limit">
                          {item.downloadLimit === null
                            ? translate(locale, "library.unlimited")
                            : translate(locale, "sell.downloadLimit") +
                              ` · ${String(item.downloadLimit)}`}
                        </dd>
                        {item.hasLicence && (
                          <dd className="font-medium text-foreground/80">
                            {translate(locale, "library.licence")}
                          </dd>
                        )}
                      </div>
                    </dl>
                  </Link>
                </Card>
              ))}
            </ul>
          )}

          {/*
            * The payment boundary, stated on the screen a buyer actually
            * reaches rather than only in a document.
            */}
          <p className="border-t border-border pt-4 text-xs text-muted">
            {translate(locale, "library.notSettled")}
          </p>
        </div>
      </Shell>
    </>
  );
}
