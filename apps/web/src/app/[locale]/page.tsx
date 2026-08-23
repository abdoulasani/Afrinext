import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { catalog } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { buttonClass, Card, EmptyState, StoreTypeIcon } from "@afrinext/ui";
import MarketSearch from "@/components/MarketSearch";
import { Shell } from "@/components/Shell";
import StoreCard from "@/components/StoreCard";
import { copyFor, locationLabel } from "@/lib/store-presentation";
import { countryNames } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * The marketplace.
 *
 * Everything here comes from the database. There is no seeded "featured"
 * flag, no rating, no follower count and no popularity that is not a count of
 * paid orders — so on the day Afrinext launches this page is honestly, and
 * deliberately, close to empty. The empty state is therefore not an
 * afterthought: it is the first screen most early visitors will see, and its
 * job is to turn a visitor into the first seller.
 */
export default async function MarketplacePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const db = getDb();
  // One round trip each, in parallel: the page is the slowest of them, not
  // the sum.
  const [newest, popular, offerings, typeCounts, countries] = await Promise.all([
    catalog.discoverStores(db, { sort: "newest", limit: 6 }),
    catalog.discoverStores(db, { sort: "popular", limit: 6 }),
    catalog.discoverOfferings(db, { limit: 6 }),
    catalog.countStoresByType(db),
    countryNames(),
  ]);

  const totalStores = Object.values(typeCounts).reduce((sum, n) => sum + n, 0);
  /*
   * "Popular" only appears once popularity is a real measurement.
   *
   * `discoverStores` orders by paid orders and never fabricates, so with no
   * sales the popular list is simply the newest list in another order. Showing
   * it then would present recency as demand. It appears when it means
   * something and not before.
   */
  const showPopular =
    popular.length >= 3 && popular[0]?.slug !== newest[0]?.slug;

  return (
    <Shell width="wide">
      {/* ---------- Hero ---------- */}
      <header
        className="relative overflow-hidden bg-primary px-5 pb-8 text-primary-contrast sm:rounded-b-[var(--radius-xl)]"
        style={{ paddingTop: "calc(2rem + env(safe-area-inset-top))" }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 70% 60% at 85% 0%, rgba(255,255,255,0.35), transparent 60%)," +
              "radial-gradient(ellipse 60% 50% at 0% 100%, rgba(0,0,0,0.25), transparent 55%)",
          }}
        />
        <div className="relative max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-85">
            {translate(locale, "market.title")}
          </p>
          <h1 className="mt-2 text-[26px] font-semibold leading-[1.15] tracking-tight sm:text-4xl">
            {translate(locale, "market.heroTitle")}
          </h1>
          <p className="mt-3 max-w-[46ch] text-sm leading-relaxed opacity-90 sm:text-base">
            {translate(locale, "market.heroBody")}
          </p>
        </div>
      </header>

      {/* ---------- Search, lifted over the hero edge ---------- */}
      <div className="relative z-10 -mt-7 px-4 sm:px-5">
        <div className="max-w-2xl">
          <MarketSearch
            action={`/${locale}/explorer`}
            label={translate(locale, "market.searchLabel")}
            placeholder={translate(locale, "market.searchPlaceholder")}
            submitLabel={translate(locale, "market.searchAction")}
          />
        </div>
      </div>

      {/* ---------- Categories ---------- */}
      <section className="px-4 pt-8 sm:px-5" aria-labelledby="categories-heading">
        <h2 id="categories-heading" className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">
          {translate(locale, "market.categories")}
        </h2>
        <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {catalog.STORE_TYPES.map((type) => {
            const copy = copyFor(type);
            const count = typeCounts[type] ?? 0;
            return (
              <li key={type}>
                <Link
                  href={`/${locale}/explorer?type=${type}` as Route}
                  className="flex h-full flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 transition-[background-color,border-color,transform] duration-[var(--duration-fast)] hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary-soft/40"
                >
                  <span className="text-primary"><StoreTypeIcon type={type} className="h-6 w-6" /></span>
                  <span className="text-[13px] font-semibold leading-tight text-foreground">
                    {translate(locale, copy.label)}
                  </span>
                  {/* A real count, or nothing. Never a decorative number. */}
                  {count > 0 && (
                    <span className="text-[11px] text-muted">
                      {translate(locale, "market.storeCount", { count })}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------- Discovery, or an honest invitation ---------- */}
      {totalStores === 0 ? (
        <section className="px-4 pt-8 sm:px-5">
          <EmptyState
            icon={<StoreTypeIcon type="service" className="h-6 w-6" />}
            title={translate(locale, "market.emptyTitle")}
            body={translate(locale, "market.emptyBody")}
            action={
              <Link href={`/${locale}/sell/nouvelle` as Route} className={buttonClass("primary", "lg")}>
                {translate(locale, "market.emptyAction")}
              </Link>
            }
          />
        </section>
      ) : (
        <>
          <StoreRow
            id="newest"
            heading={translate(locale, "market.newestStores")}
            body={translate(locale, "market.newestStoresBody")}
            seeAll={{ href: `/${locale}/explorer`, label: translate(locale, "market.seeAll") }}
            stores={newest}
            locale={locale}
            countries={countries}
          />

          {showPopular && (
            <StoreRow
              id="popular"
              heading={translate(locale, "market.popularStores")}
              seeAll={{
                href: `/${locale}/explorer?sort=popular`,
                label: translate(locale, "market.seeAll"),
              }}
              stores={popular}
              locale={locale}
              countries={countries}
            />
          )}

          {offerings.length > 0 && (
            <section className="px-4 pt-9 sm:px-5" aria-labelledby="offerings-heading">
              <h2 id="offerings-heading" className="text-lg font-semibold tracking-tight text-foreground">
                {translate(locale, "market.latestOfferings")}
              </h2>
              <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {offerings.map((offering) => (
                  <Card as="li" key={`${offering.storeSlug}/${offering.slug}`} interactive>
                    <Link
                      href={`/${locale}/s/${offering.storeSlug}/${offering.slug}` as Route}
                      className="flex gap-3 p-3.5"
                    >
                      <div
                        data-brand={offering.brand}
                        aria-hidden="true"
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--brand-soft)] text-[var(--brand)]"
                      >
                        <StoreTypeIcon type={offering.storeType} className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-foreground">
                          {offering.title}
                        </p>
                        <p className="truncate text-[12px] text-muted">{offering.storeName}</p>
                        <p className="mt-1 text-[13px] font-semibold tabular-nums text-primary">
                          {formatPrice(offering.price, locale)}
                        </p>
                      </div>
                    </Link>
                  </Card>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}

/** A titled row of store cards. Used more than once, so it exists once. */
function StoreRow({
  id, heading, body, seeAll, stores, locale, countries,
}: {
  id: string;
  heading: string;
  body?: string;
  seeAll: { href: string; label: string };
  stores: readonly catalog.StoreSummary[];
  locale: "fr" | "en";
  countries: Readonly<Record<string, string>>;
}) {
  if (stores.length === 0) return null;
  return (
    <section className="px-4 pt-9 sm:px-5" aria-labelledby={`${id}-heading`}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight text-foreground">
            {heading}
          </h2>
          {body !== undefined && <p className="mt-0.5 text-[13px] text-muted">{body}</p>}
        </div>
        <Link
          href={seeAll.href as Route}
          className="shrink-0 text-[13px] font-semibold text-primary hover:underline"
        >
          {seeAll.label}
        </Link>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((store) => (
          <StoreCard
            key={store.slug}
            href={`/${locale}/s/${store.slug}`}
            name={store.name}
            tagline={store.tagline}
            brand={store.brand}
            storeType={store.storeType}
            typeLabel={translate(locale, copyFor(store.storeType).singular)}
            location={locationLabel(
              store.city,
              store.countryCode === null ? null : countries[store.countryCode] ?? store.countryCode,
            )}
            offeringLabel={
              store.offeringCount === 0
                ? translate(locale, "market.noOfferingsYet")
                : translate(locale, "market.offeringCount", { count: store.offeringCount })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function formatPrice(price: { amountMinor: bigint; currency: string }, locale: string): string {
  // XOF has zero decimals; the registry knows, and `formatMoney` reads it.
  // Here we only need the grouped integer, which Intl gets right for fr-FR.
  return `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB").format(price.amountMinor)} ${price.currency}`;
}
