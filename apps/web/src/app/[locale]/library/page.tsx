import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { content, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { Badge, buttonClass, EmptyState, PriceTag, StoreTypeIcon } from "@afrinext/ui";
import { PageIntro } from "@/components/PageIntro";
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
      <PageIntro
        eyebrow={translate(locale, "library.eyebrow")}
        title={translate(locale, "library.title")}
        {...(owned.length > 0
          ? { body: translate(locale, "library.countOwned", { count: owned.length }) }
          : {})}
      />
      <Shell width="wide">
        <div className="px-4 pt-6 sm:px-6">
          {owned.length === 0 ? (
            <EmptyState
              icon={<StoreTypeIcon type="digital_product" className="h-6 w-6" />}
              title={translate(locale, "library.emptyTitle")}
              body={translate(locale, "library.emptyBody")}
              action={
                <Link href={`/${locale}/explorer` as Route} className={buttonClass("solid", "lg")}>
                  {translate(locale, "library.emptyAction")}
                </Link>
              }
            />
          ) : (
            /*
             * A collection, two-up, with a plate for each thing owned.
             *
             * The plates are INK rather than the seller's brand, and that is a
             * deliberate difference from the marketplace. On a storefront the
             * colour is the seller's, because you are looking at their shop.
             * Here you are looking at YOUR shelf, so the shelf is one material
             * and the copper mark is the same on every item — which is also
             * what makes "I own this" read at a glance rather than "this was
             * sold by someone".
             */
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 lg:grid-cols-4">
              {owned.map((item) => (
                <li key={item.productId} className="group" data-testid="library-item">
                  <Link
                    href={`/${locale}/library/${item.storeSlug}/${item.productSlug}` as Route}
                    className="block focus-visible:outline-none"
                  >
                    <div
                      className={
                        "relative isolate aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] " +
                        "bg-ink transition-transform duration-[var(--duration-base)] " +
                        "ease-[var(--ease-out)] group-hover:-translate-y-[3px] " +
                        "group-focus-visible:-translate-y-[3px]"
                      }
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 opacity-60"
                        style={{
                          backgroundImage:
                            "radial-gradient(ellipse 100% 130% at 12% -10%, var(--copper), transparent 62%)",
                        }}
                      />
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 grid place-items-center text-[var(--on-ink)] opacity-90"
                      >
                        <StoreTypeIcon type="digital_product" className="h-8 w-8" />
                      </span>
                      <span className="absolute left-2.5 top-2.5 z-10">
                        <Badge tone="onInk">
                          {translate(locale, "library.version", { n: item.versionNo })}
                        </Badge>
                      </span>
                    </div>

                    <h2 className="mt-3 line-clamp-2 text-h3 text-foreground">{item.title}</h2>
                    <p className="mt-1 truncate text-caption text-muted">{item.storeName}</p>

                    {/*
                     * A fact about the product, not a promise about this
                     * purchase. The card flags only that a newer version
                     * exists; the product page explains what that does and does
                     * not mean.
                     */}
                    {item.latestVersionNo > item.versionNo && (
                      <p
                        data-testid="library-newer"
                        className="mt-1 text-caption font-medium text-copper"
                      >
                        {translate(locale, "library.newerVersion", { n: item.latestVersionNo })}
                      </p>
                    )}

                    <dl className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
                      <div>
                        <dt className="sr-only">{translate(locale, "library.files", { count: 0 })}</dt>
                        <dd>{translate(locale, "library.files", { count: item.assetCount })}</dd>
                      </div>
                      {/*
                       * The limit, stated on the card so a buyer knows before
                       * they open it. `null` is genuinely unlimited and says
                       * so rather than showing an invented number.
                       */}
                      <div data-testid="library-limit">
                        <dt className="sr-only">{translate(locale, "sell.downloadLimit")}</dt>
                        <dd className="before:text-faint before:content-['·_']">
                          {item.downloadLimit === null
                            ? translate(locale, "library.unlimited")
                            : translate(locale, "sell.downloadLimit") +
                              ` · ${String(item.downloadLimit)}`}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <PriceTag amount={m.formatMoney(item.price, registry)} size="sm" />
                      <span className="text-caption text-faint">{dateOf(item.grantedAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/*
           * The payment boundary, stated on the screen a buyer actually
           * reaches rather than only in a document.
           */}
          <p className="mt-10 border-t border-border pt-5 text-caption text-faint">
            {translate(locale, "library.notSettled")}
          </p>
        </div>
      </Shell>
    </>
  );
}
