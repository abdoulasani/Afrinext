import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { catalog } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { buttonClass, EmptyState, StoreTypeIcon } from "@afrinext/ui";
import MarketSearch from "@/components/MarketSearch";
import { Shell } from "@/components/Shell";
import StoreCard from "@/components/StoreCard";
import { countryNames } from "@/lib/catalog";
import { copyFor, locationLabel } from "@/lib/store-presentation";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

/**
 * Search and browse, with every piece of state in the URL.
 *
 * A query, a type filter, a sort and a page — all search params, so a result
 * is a link somebody can send to a friend, the back button steps through
 * searches, and the whole screen renders on the server with no client
 * JavaScript at all. That last point is not a purity exercise: this is a
 * marketplace for phones on mobile data, and the fastest search result is one
 * that arrives as HTML.
 *
 * Pagination rather than infinite scroll, for the same reason — and because
 * an infinite list has no reachable end for a keyboard or screen-reader user.
 */
export default async function ExplorerPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;

  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const text = (first(sp["q"]) ?? "").trim();
  const rawType = first(sp["type"]);
  // An unknown type in the URL is ignored rather than refused: a stale or
  // hand-edited link should show the marketplace, not an error page.
  const type = catalog.isStoreType(rawType) ? rawType : undefined;
  const sort = first(sp["sort"]) === "popular" ? "popular" as const : "newest" as const;
  const pageParam = Number.parseInt(first(sp["page"]) ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.min(pageParam, 400) : 1;

  const db = getDb();
  const query = {
    ...(type !== undefined ? { type } : {}),
    ...(text !== "" ? { text } : {}),
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const [stores, total, countries] = await Promise.all([
    catalog.discoverStores(db, query),
    catalog.countDiscoverableStores(db, query),
    countryNames(locale),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = text !== "" || type !== undefined;

  /** Rebuilds this URL with one parameter changed. Keeps the rest intact. */
  const urlWith = (patch: Record<string, string | undefined>): string => {
    const next = new URLSearchParams();
    if (text !== "") next.set("q", text);
    if (type !== undefined) next.set("type", type);
    if (sort !== "newest") next.set("sort", sort);
    if (page > 1) next.set("page", String(page));
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return `/${locale}/explorer${qs === "" ? "" : `?${qs}`}`;
  };

  return (
    <Shell width="wide">
      <header
        className="px-4 pb-4 sm:px-5"
        style={{ paddingTop: "calc(1.5rem + env(safe-area-inset-top))" }}
      >
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {translate(locale, "explore.title")}
        </h1>
        <div className="mt-3">
          <MarketSearch
            action={`/${locale}/explorer`}
            label={translate(locale, "market.searchLabel")}
            placeholder={translate(locale, "market.searchPlaceholder")}
            submitLabel={translate(locale, "market.searchAction")}
            defaultValue={text}
          />
        </div>
      </header>

      {/* Type filter. A horizontal scroller on a phone, a wrap on a desktop. */}
      <nav aria-label={translate(locale, "market.categories")} className="px-4 sm:px-5">
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
          <li>
            <Link
              href={urlWith({ type: undefined, page: undefined }) as Route}
              aria-current={type === undefined ? "true" : undefined}
              className={chip(type === undefined)}
            >
              {translate(locale, "explore.allTypes")}
            </Link>
          </li>
          {catalog.STORE_TYPES.map((candidate) => (
            <li key={candidate}>
              <Link
                href={urlWith({ type: candidate, page: undefined }) as Route}
                aria-current={type === candidate ? "true" : undefined}
                className={chip(type === candidate)}
              >
                <StoreTypeIcon type={candidate} className="h-4 w-4" />
                {translate(locale, copyFor(candidate).label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-5">
        <p aria-live="polite" className="text-[13px] text-muted">
          {translate(locale, "explore.resultsCount", { count: total })}
        </p>
        {/* Sorting by sales only offered when sales could exist. */}
        <div className="flex gap-1.5">
          <Link href={urlWith({ sort: undefined, page: undefined }) as Route} className={chip(sort === "newest", true)}>
            {translate(locale, "explore.sortNewest")}
          </Link>
          <Link href={urlWith({ sort: "popular", page: undefined }) as Route} className={chip(sort === "popular", true)}>
            {translate(locale, "explore.sortPopular")}
          </Link>
        </div>
      </div>

      <section className="px-4 pt-3 sm:px-5">
        {stores.length === 0 ? (
          <EmptyState
            icon={<StoreTypeIcon type={type ?? "service"} className="h-6 w-6" />}
            title={translate(locale, filtered ? "explore.noResultsTitle" : "market.emptyTitle")}
            body={translate(locale, filtered ? "explore.noResultsBody" : "market.emptyBody")}
            action={
              filtered ? (
                <Link href={`/${locale}/explorer` as Route} className={buttonClass("secondary", "md")}>
                  {translate(locale, "explore.clearFilters")}
                </Link>
              ) : (
                <Link href={`/${locale}/sell/nouvelle` as Route} className={buttonClass("primary", "lg")}>
                  {translate(locale, "market.emptyAction")}
                </Link>
              )
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        )}
      </section>

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 pt-6 sm:px-5">
          {page > 1 ? (
            <Link href={urlWith({ page: String(page - 1) }) as Route} className={buttonClass("secondary", "sm")}>
              {translate(locale, "explore.previous")}
            </Link>
          ) : (
            <span />
          )}
          <p className="text-[13px] tabular-nums text-muted">
            {translate(locale, "explore.page", { page, total: pages })}
          </p>
          {page < pages ? (
            <Link href={urlWith({ page: String(page + 1) }) as Route} className={buttonClass("secondary", "sm")}>
              {translate(locale, "explore.next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </Shell>
  );
}

/** A filter pill. Selection is weight and colour AND aria-current, never colour alone. */
function chip(active: boolean, small = false): string {
  return (
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 " +
    (small ? "py-1 text-[12px] " : "py-2 text-[13px] ") +
    "font-medium transition-colors duration-[var(--duration-fast)] " +
    (active
      ? "border-primary bg-primary text-primary-contrast"
      : "border-border bg-surface text-muted hover:border-muted/50 hover:text-foreground")
  );
}
