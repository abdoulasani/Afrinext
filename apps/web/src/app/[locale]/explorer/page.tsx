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
      {/*
       * The search sits on the sunset band, not on the page ground.
       *
       * It is the same field the home screen carries, and it is the reason the
       * two screens feel like one product: search is what Explorer IS, so
       * giving it the strongest surface on the page puts the eye exactly where
       * the work happens. On ivory it was a white box on a near-white ground —
       * technically fine, and completely unremarkable.
       */}
      <div
        className="relative isolate overflow-hidden text-[var(--on-brand)]"
        style={{
          backgroundImage:
            "linear-gradient(168deg, var(--copper) 0%, #b33e14 60%, #92300f 100%)",
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 95% at 90% -8%, #f8c46b, transparent 64%)",
          }}
        />
        <div
          className="relative mx-auto max-w-2xl px-4 pb-8 sm:px-6 lg:max-w-5xl xl:max-w-6xl"
          style={{ paddingTop: "calc(1.75rem + env(safe-area-inset-top))" }}
        >
          <p className="text-label uppercase text-[var(--on-brand-muted)]">
            {translate(locale, "explore.eyebrow")}
          </p>
          <h1 className="mt-1.5 text-h1 text-white">
            {translate(locale, "explore.title")}
          </h1>
          <div className="mt-5 max-w-xl">
            <MarketSearch
              action={`/${locale}/explorer`}
              label={translate(locale, "market.searchLabel")}
              placeholder={translate(locale, "market.searchPlaceholder")}
              submitLabel={translate(locale, "market.searchAction")}
              defaultValue={text}
            />
          </div>
        </div>
      </div>

      {/*
       * Categories as tiles, not as pills.
       *
       * Six flat chips in a row said "these are filter values". Six pastilles
       * in their own tones say "these are six different places", which is the
       * thing somebody arriving at Explorer actually wants to know. Each keeps
       * the identity colour it has everywhere else, so the rail here, the grid
       * on the home screen and the storefronts are one system.
       *
       * A horizontal scroller on a phone, a wrap from `sm`. The card the tiles
       * sit in overlaps the band above, which is what stops the page reading as
       * two stacked rectangles.
       */}
      <nav
        aria-label={translate(locale, "market.categories")}
        /*
         * `relative z-10` is what makes the overlap work, and it took a
         * screenshot to see why: the band above is `relative`, the rail was
         * not, and a positioned element paints over an unpositioned sibling
         * that comes after it. The tiles were being drawn and then covered,
         * which looks exactly like clipping and is not.
         */
        className="relative z-10 mx-auto -mt-8 max-w-2xl px-4 sm:px-6 lg:max-w-5xl xl:max-w-6xl"
      >
        {/*
         * `py-3` inside the scroller, not margin outside it.
         *
         * `overflow-x-auto` clips vertically too, so the first version — which
         * pulled the rail up with a negative margin and gave the list one pixel
         * of top padding — sliced the top off every tile and its shadow. The
         * overlap now comes from the nav, and the room the tiles need comes
         * from inside the thing that does the clipping.
         */}
        <ul
          className={
            "-mx-4 flex gap-2.5 overflow-x-auto px-4 py-3 [scrollbar-width:none] " +
            "sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          }
        >
          <li>
            <Link
              href={urlWith({ type: undefined, page: undefined }) as Route}
              aria-current={type === undefined ? "true" : undefined}
              className={typeTile(type === undefined)}
            >
              <span
                className={
                  "flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] " +
                  (type === undefined
                    ? "bg-[color-mix(in_srgb,#fff_24%,transparent)] text-white"
                    : "bg-surface-muted text-muted")
                }
              >
                <StoreTypeIcon type="service" className="h-[18px] w-[18px]" />
              </span>
              {translate(locale, "explore.allTypes")}
            </Link>
          </li>
          {catalog.STORE_TYPES.map((candidate) => {
            const copy = copyFor(candidate);
            const active = type === candidate;
            return (
              <li key={candidate}>
                <Link
                  href={urlWith({ type: candidate, page: undefined }) as Route}
                  aria-current={active ? "true" : undefined}
                  className={typeTile(active)}
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)]"
                    style={
                      active
                        ? { backgroundColor: "color-mix(in srgb, #fff 24%, transparent)", color: "#fff" }
                        : {
                            backgroundColor: `var(--brand-${copy.tone}-soft)`,
                            color: `var(--brand-${copy.tone})`,
                          }
                    }
                  >
                    <StoreTypeIcon type={candidate} className="h-[18px] w-[18px]" />
                  </span>
                  {translate(locale, copy.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 px-4 pt-5 sm:px-6 lg:max-w-5xl xl:max-w-6xl">
        <p aria-live="polite" className="text-small font-medium text-foreground">
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

      <section className="mx-auto max-w-2xl px-4 pt-4 sm:px-6 lg:max-w-5xl xl:max-w-6xl">
        {stores.length === 0 ? (
          <EmptyState
            tone={type === undefined ? "ochre" : copyFor(type).tone}
            icon={<StoreTypeIcon type={type ?? "service"} className="h-7 w-7" />}
            title={translate(locale, filtered ? "explore.noResultsTitle" : "market.emptyTitle")}
            body={translate(locale, filtered ? "explore.noResultsBody" : "market.emptyBody")}
            action={
              filtered ? (
                <Link href={`/${locale}/explorer` as Route} className={buttonClass("outline", "md")}>
                  {translate(locale, "explore.clearFilters")}
                </Link>
              ) : (
                <Link href={`/${locale}/sell/nouvelle` as Route} className={buttonClass("solid", "lg")}>
                  {translate(locale, "market.emptyAction")}
                </Link>
              )
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 pt-8 sm:px-6">
          {page > 1 ? (
            <Link href={urlWith({ page: String(page - 1) }) as Route} className={buttonClass("outline", "md")}>
              {translate(locale, "explore.previous")}
            </Link>
          ) : (
            <span />
          )}
          <p className="text-small tabular-nums text-muted">
            {translate(locale, "explore.page", { page, total: pages })}
          </p>
          {page < pages ? (
            <Link href={urlWith({ page: String(page + 1) }) as Route} className={buttonClass("outline", "md")}>
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

/**
 * A filter pill.
 *
 * Selected is ink-on-sand — maximum contrast, and the same "this is the one"
 * language the primary button speaks. Selection is carried by weight and
 * colour AND by `aria-current`, never by colour alone: a filter a
 * colour-blind or screen-reader user cannot identify is a filter that does not
 * work.
 *
 * The touch target is the padding. `py-2.5` puts these at 40px on a phone,
 * which is the floor for a control in a horizontal scroller where a mis-tap
 * costs a page load.
 */
/**
 * A category tile: a pastille, then a word, in a card that can be tapped.
 *
 * Taller than a chip on purpose — 56px, comfortably over the 44px floor —
 * because these sit in a horizontal scroller where a mis-tap costs a page
 * load, and because a tile with a coloured square in it needs room to be a
 * tile rather than a chip with an ornament.
 */
function typeTile(active: boolean): string {
  return (
    "inline-flex h-14 shrink-0 items-center gap-2.5 rounded-[var(--radius-lg)] border " +
    "pl-2 pr-4 text-small font-medium " +
    "transition-[background-color,border-color,color,transform,box-shadow] " +
    "duration-[var(--duration-fast)] active:scale-[0.97] " +
    (active
      ? "border-transparent bg-primary text-primary-contrast shadow-[var(--shadow-md)]"
      : "border-border bg-surface text-foreground shadow-[var(--shadow-sm)] " +
        "hover:border-border-strong hover:shadow-[var(--shadow-md)]")
  );
}

function chip(active: boolean, small = false): string {
  return (
    "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border " +
    /*
     * Both sizes are 44px tall, the mobile touch-target floor, set as a
     * minimum height rather than left to padding arithmetic — the sort chips
     * measured 113x35 with padding alone, then 113x39 after one nudge, which
     * is how "close enough" gets shipped twice. A control that changes the
     * whole result set is not the place to save six pixels of rhythm.
     */
    "min-h-11 " +
    (small ? "px-3.5 text-caption " : "px-4 text-small ") +
    "font-medium transition-[background-color,border-color,color,transform] " +
    "duration-[var(--duration-fast)] active:scale-[0.97] " +
    (active
      ? "border-transparent bg-primary text-primary-contrast shadow-[var(--shadow-sm)]"
      : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground")
  );
}
