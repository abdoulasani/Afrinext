import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { catalog } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate, type Locale } from "@afrinext/i18n";
import {
  buttonClass, Badge, EmptyState, ProductCard, SectionHeader,
  StoreAvatar, StoreCover, StoreTypeIcon,
} from "@afrinext/ui";
import { HomeTop } from "@/components/HomeTop";
import MarketSearch from "@/components/MarketSearch";
import { Shell } from "@/components/Shell";
import StoreCard from "@/components/StoreCard";
import { copyFor, locationLabel } from "@/lib/store-presentation";
import { countryNames } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The marketplace.
 *
 * ---------------------------------------------------------------------------
 * What this page is allowed to claim
 * ---------------------------------------------------------------------------
 *
 * Everything comes from the database. There is no seeded "featured" flag, no
 * rating, no follower count and no popularity that is not a count of paid
 * orders — so on launch day this page is honestly, deliberately close to
 * empty. The empty state is not an afterthought here: it is the first screen
 * most early visitors will see, and its job is to turn a visitor into the
 * first seller.
 *
 * "À la une" is the newest published store, said in those words. It is not a
 * curation nobody performed.
 *
 * ---------------------------------------------------------------------------
 * The shape of the page, and why
 * ---------------------------------------------------------------------------
 *
 * The old version was one long column of identically-weighted cards, each with
 * a full-width saturated cover — 4 000 pixels of scroll in which nothing was
 * more important than anything else. This one moves in deliberate steps:
 *
 *   an ink hero        who we are, and the search, over one dark panel
 *   the six worlds     quiet tiles, copper marks, real counts or nothing
 *   one lead store     given real size, because a marketplace needs a subject
 *   the rest, smaller  a grid, so six stores cost one screen and not four
 *   latest offerings   two columns of plates with prices set large
 *   an invitation      the seller pitch, on ink, closing the page
 *
 * Hierarchy comes from size, weight and space — not from wrapping every item
 * in another bordered box.
 */
export default async function MarketplacePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const db = getDb();
  // One round trip each, in parallel: the page costs the slowest, not the sum.
  const [newest, popular, offerings, typeCounts, countries] = await Promise.all([
    catalog.discoverStores(db, { sort: "newest", limit: 7 }),
    catalog.discoverStores(db, { sort: "popular", limit: 6 }),
    catalog.discoverOfferings(db, { limit: 6 }),
    catalog.countStoresByType(db),
    countryNames(),
  ]);

  const signedIn = (await currentActor()) !== undefined;
  const totalStores = Object.values(typeCounts).reduce((sum, n) => sum + n, 0);
  const [lead, ...rest] = newest;

  /*
   * "Popular" only appears once popularity is a real measurement.
   *
   * `discoverStores` orders by paid orders and never fabricates, so with no
   * sales the popular list is simply the newest list in another order. Showing
   * it then would present recency as demand. It appears when it means
   * something, and not before.
   */
  const showPopular = popular.length >= 3 && popular[0]?.slug !== newest[0]?.slug;

  return (
    <Shell width="wide">
      {/*
       * Two openings, one page.
       *
       * Somebody signed in gets their own screen: a compact header, their real
       * activity, and the shortcuts they use. A visitor gets the marketplace
       * pitch, because they have no activity to show and inventing some would
       * be the one thing this redesign must not do. `HomeTop` returns null when
       * nobody is signed in, so the hero below is the visitor's opening.
       */}
      <HomeTop locale={locale} />
      {signedIn ? null : <Hero locale={locale} totalStores={totalStores} />}

      <Worlds locale={locale} typeCounts={typeCounts} />

      {totalStores === 0 ? (
        <section className="px-4 pt-10 sm:px-6">
          <EmptyState
            icon={<StoreTypeIcon type="service" className="h-6 w-6" />}
            title={translate(locale, "market.emptyTitle")}
            body={translate(locale, "market.emptyBody")}
            action={
              <Link href={`/${locale}/sell/nouvelle` as Route} className={buttonClass("solid", "lg")}>
                {translate(locale, "market.emptyAction")}
              </Link>
            }
          />
        </section>
      ) : (
        <>
          {lead !== undefined && (
            <LeadStore locale={locale} store={lead} countries={countries} />
          )}

          {rest.length > 0 && (
            <StoreGrid
              id="newest"
              heading={translate(locale, "market.newestStores")}
              body={translate(locale, "market.newestStoresBody")}
              seeAll={{ href: `/${locale}/explorer`, label: translate(locale, "market.seeAll") }}
              stores={rest}
              locale={locale}
              countries={countries}
            />
          )}

          {showPopular && (
            <StoreGrid
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
            <section className="px-4 pt-12 sm:px-6" aria-labelledby="offerings-heading">
              <SectionHeader
                id="offerings-heading"
                title={translate(locale, "market.latestOfferings")}
                body={translate(locale, "market.offeringsBody")}
                action={
                  <Link
                    href={`/${locale}/explorer` as Route}
                    /*
             * The padding is the touch target, not decoration. Measured at
             * 59x17 before it: a "see all" link that a thumb cannot reliably
             * hit is a link that does not exist on a phone. The negative
             * margin keeps it optically aligned with the heading beside it.
             */
            className={
              "-my-2 -mr-2 inline-flex min-h-11 items-center rounded-[var(--radius-sm)] px-2 " +
              "text-small font-semibold text-foreground underline-offset-4 " +
              "transition-colors hover:bg-surface-muted hover:underline"
            }
                  >
                    {translate(locale, "market.seeAll")}
                  </Link>
                }
              />
              <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 lg:grid-cols-4">
                {offerings.map((offering) => (
                  <ProductCard
                    key={`${offering.storeSlug}/${offering.slug}`}
                    href={`/${locale}/s/${offering.storeSlug}/${offering.slug}`}
                    title={offering.title}
                    storeName={offering.storeName}
                    price={formatPrice(offering.price, locale)}
                    brand={offering.brand}
                    mark={<StoreTypeIcon type={offering.storeType} className="h-8 w-8" />}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <SellInvitation locale={locale} />
    </Shell>
  );
}

/* ========================================================================= */

/**
 * The hero: one ink panel, and the only place on the page that is dark.
 *
 * Two decisions carry it. First, the ground is ink rather than the brand
 * colour — an orange block that size does not read as premium, it reads as a
 * banner, and it spends the accent before the page has said anything. Second,
 * the search field is a light, raised surface sitting ON the ink, which puts
 * the strongest contrast on the page exactly where the primary action is.
 *
 * The panel bleeds past the container on purpose: a dark rectangle with sand
 * showing down both sides looks like a component, and the first thing a
 * visitor sees should look like a place.
 */
function Hero({ locale, totalStores }: { locale: Locale; totalStores: number }) {
  return (
    <header
      className="relative isolate overflow-hidden text-[var(--on-brand)]"
      style={{
        /* The same sunset the signed-in header uses, so a visitor and a member
           are looking at one product. Darkening downward, because the small
           white copy sits over the top. */
        backgroundImage:
          "linear-gradient(168deg, var(--copper) 0%, #b33e14 55%, #92300f 100%)",
      }}
    >
      {/* The low sun, off the top-right corner. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 55% 80% at 92% -10%, #f6b352, transparent 62%)",
        }}
      />
      {/* A fine grain, which is what stops a large dark area looking flat. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(42deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 7px)",
        }}
      />

      <div
        className="relative mx-auto max-w-2xl px-5 pb-9 sm:px-6 lg:max-w-5xl xl:max-w-6xl"
        style={{ paddingTop: "calc(2.25rem + env(safe-area-inset-top))" }}
      >
        <p className="text-label uppercase text-[var(--on-brand-muted)]">
          {translate(locale, "market.eyebrow")}
        </p>

        <h1 className="mt-3.5 max-w-[16ch] text-display text-white sm:text-[3.25rem]">
          {translate(locale, "market.heroTitle")}
        </h1>

        <p className="mt-3.5 max-w-[46ch] text-body text-[var(--on-brand-muted)]">
          {translate(locale, "market.heroBody")}
        </p>

        <div className="mt-6 max-w-xl">
          <MarketSearch
            action={`/${locale}/explorer`}
            label={translate(locale, "market.searchLabel")}
            placeholder={translate(locale, "market.searchPlaceholder")}
            submitLabel={translate(locale, "market.searchAction")}
          />
        </div>

        {/*
         * Two actions, and the marketplace one wins.
         *
         * `grid` rather than `flex-wrap`: at 390px the explore label is wider
         * than half the screen, so wrapping produced one full button and one
         * orphan sitting under it. Full width each on a phone, side by side
         * from `sm`, and both drawn for an ink ground so the second reads as
         * an alternative rather than as a disabled control.
         */}
        <div className="mt-5 grid max-w-xl gap-2.5 sm:grid-flow-col sm:justify-start">
          <Link href={`/${locale}/explorer` as Route} className={buttonClass("inverse", "lg")}>
            {translate(locale, "market.heroExplore")}
          </Link>
          <Link
            href={`/${locale}/sell/nouvelle` as Route}
            className={buttonClass("inverseOutline", "lg")}
          >
            {translate(locale, "market.heroSell")}
          </Link>
        </div>

        {/*
         * Real numbers or no numbers.
         *
         * Two figures, both counted from rows that exist: published stores, and
         * the fixed number of store types. No "10 000 clients satisfaits", no
         * growth curve, nothing a visitor could later discover was decoration.
         */}
        {totalStores > 0 && (
          <dl className="mt-8 flex items-stretch gap-8 border-t border-[var(--on-ink-line)] pt-5">
            <Stat value={String(totalStores)} label={translate(locale, "market.statStores")} />
            <Stat
              value={String(catalog.STORE_TYPES.length)}
              label={translate(locale, "market.statCategories")}
            />
          </dl>
        )}
      </div>
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="block text-h1 tabular-nums text-[var(--on-ink)]">{value}</span>
        <span className="mt-0.5 block text-caption text-[var(--on-ink-muted)]">{label}</span>
      </dd>
    </div>
  );
}

/* ========================================================================= */

/**
 * The six worlds.
 *
 * Tiles rather than cards: a sunken surface, no border, a copper mark. The
 * previous version gave each one a white card with a full border and a shadow,
 * which made six navigation shortcuts compete with the actual merchandise
 * further down the page.
 */
function Worlds({
  locale, typeCounts,
}: {
  locale: Locale;
  typeCounts: Readonly<Record<string, number>>;
}) {
  return (
    <section className="px-4 pt-10 sm:px-6" aria-labelledby="categories-heading">
      <SectionHeader
        id="categories-heading"
        title={translate(locale, "market.categories")}
        body={translate(locale, "market.categoriesBody")}
      />
      <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {catalog.STORE_TYPES.map((type) => {
          const copy = copyFor(type);
          const count = typeCounts[type] ?? 0;
          return (
            <li key={type}>
              <Link
                href={`/${locale}/explorer?type=${type}` as Route}
                className={
                  "flex h-full flex-col gap-3 rounded-[var(--radius-lg)] border border-border " +
                  "bg-surface p-4 shadow-[var(--shadow-sm)] " +
                  "transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] " +
                  "ease-[var(--ease-out)] hover:-translate-y-[3px] hover:border-border-strong " +
                  "hover:shadow-[var(--shadow-md)] active:translate-y-0 active:duration-[80ms]"
                }
              >
                {/*
                 * A pastille per world, in that world's own tone — the same
                 * six identities the shortcut grid and the storefronts use. Six
                 * copper icons in a row said "these are all the same"; six
                 * tones say "these are six different places", which is the only
                 * thing this section exists to communicate.
                 */}
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)]"
                  style={{
                    backgroundColor: `var(--brand-${copy.tone}-soft)`,
                    color: `var(--brand-${copy.tone})`,
                  }}
                >
                  <StoreTypeIcon type={type} className="h-[22px] w-[22px]" />
                </span>
                <span className="mt-auto">
                  <span className="block text-small font-semibold leading-tight text-foreground">
                    {translate(locale, copy.label)}
                  </span>
                  {/* A real count, or nothing. Never a decorative number. */}
                  {count > 0 && (
                    <span className="mt-0.5 block text-caption text-muted">
                      {translate(locale, "market.storeCount", { count })}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ========================================================================= */

/**
 * One store, given real estate.
 *
 * A marketplace page needs a subject. Six identical cards give the eye nowhere
 * to land, so the newest store gets a tall cover, its name at display size and
 * an explicit action — and the five behind it become a quiet grid. That single
 * change is most of the difference between "a list of records" and "a place
 * with something happening in it".
 */
function LeadStore({
  locale, store, countries,
}: {
  locale: Locale;
  store: catalog.StoreSummary;
  countries: Readonly<Record<string, string>>;
}) {
  const where = locationLabel(
    store.city,
    store.countryCode === null ? null : countries[store.countryCode] ?? store.countryCode,
  );
  return (
    <section className="px-4 pt-12 sm:px-6" aria-labelledby="featured-heading">
      <SectionHeader
        id="featured-heading"
        eyebrow={translate(locale, "market.featured")}
        title={store.name}
        body={store.tagline ?? translate(locale, "market.featuredBody")}
      />
      <Link
        href={`/${locale}/s/${store.slug}` as Route}
        data-testid="lead-store"
        className="group mt-5 block focus-visible:outline-none"
      >
        <StoreCover
          brand={store.brand}
          scrim
          className={
            "h-56 rounded-[var(--radius-xl)] transition-transform sm:h-72 " +
            "duration-[var(--duration-base)] ease-[var(--ease-out)] " +
            "group-hover:-translate-y-1 group-focus-visible:-translate-y-1"
          }
        >
          <div className="flex h-full flex-col justify-between p-5 sm:p-6">
            <div className="flex justify-end">
              <Badge tone="onInk">
                <StoreTypeIcon type={store.storeType} className="h-3.5 w-3.5" />
                {translate(locale, copyFor(store.storeType).singular)}
              </Badge>
            </div>
            <div className="flex items-end gap-4">
              <StoreAvatar name={store.name} brand={store.brand} size="lg" />
              <div className="min-w-0 pb-1">
                <p className="truncate text-h2 text-[var(--on-ink)]">{store.name}</p>
                <p className="mt-1 text-small text-[var(--on-ink-muted)]">
                  {store.offeringCount === 0
                    ? translate(locale, "market.noOfferingsYet")
                    : translate(locale, "market.offeringCount", { count: store.offeringCount })}
                  {where !== null && <> · {where}</>}
                </p>
              </div>
            </div>
          </div>
        </StoreCover>
      </Link>
    </section>
  );
}

/** A titled grid of store cards. Used more than once, so it exists once. */
function StoreGrid({
  id, eyebrow, heading, body, seeAll, stores, locale, countries,
}: {
  id: string;
  eyebrow?: string;
  heading: string;
  body?: string;
  seeAll: { href: string; label: string };
  stores: readonly catalog.StoreSummary[];
  locale: Locale;
  countries: Readonly<Record<string, string>>;
}) {
  if (stores.length === 0) return null;
  return (
    <section className="px-4 pt-12 sm:px-6" aria-labelledby={`${id}-heading`}>
      <SectionHeader
        id={`${id}-heading`}
        {...(eyebrow !== undefined ? { eyebrow } : {})}
        title={heading}
        {...(body !== undefined ? { body } : {})}
        action={
          <Link
            href={seeAll.href as Route}
            /*
             * The padding is the touch target, not decoration. Measured at
             * 59x17 before it: a "see all" link that a thumb cannot reliably
             * hit is a link that does not exist on a phone. The negative
             * margin keeps it optically aligned with the heading beside it.
             */
            className={
              "-my-2 -mr-2 inline-flex min-h-11 items-center rounded-[var(--radius-sm)] px-2 " +
              "text-small font-semibold text-foreground underline-offset-4 " +
              "transition-colors hover:bg-surface-muted hover:underline"
            }
          >
            {seeAll.label}
          </Link>
        }
      />
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

/* ========================================================================= */

/**
 * The close: an invitation to sell.
 *
 * A marketplace has two audiences and the page has so far spoken to one. This
 * is on ink, so it bookends the hero and signals "this is Afrinext talking"
 * rather than "here is more merchandise", and it is the one place on the page
 * where a copper button is spent.
 */
function SellInvitation({ locale }: { locale: Locale }) {
  return (
    <section className="px-4 pt-14 sm:px-6">
      <div className="on-ink relative isolate overflow-hidden rounded-[var(--radius-xl)] bg-ink p-7 sm:p-10">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 70% 90% at 100% 110%, var(--copper), transparent 60%)",
          }}
        />
        <div className="relative max-w-[46ch]">
          <p className="text-label uppercase text-copper-on-ink">
            {translate(locale, "market.sellEyebrow")}
          </p>
          <h2 className="mt-3 text-h1 text-[var(--on-ink)]">
            {translate(locale, "market.sellTitle")}
          </h2>
          <p className="mt-3 text-body text-[var(--on-ink-muted)]">
            {translate(locale, "market.sellBody")}
          </p>
          <Link
            href={`/${locale}/sell/nouvelle` as Route}
            className={buttonClass("accent", "lg", "mt-6")}
          >
            {translate(locale, "market.sellAction")}
          </Link>
        </div>
      </div>
    </section>
  );
}

function formatPrice(price: { amountMinor: bigint; currency: string }, locale: string): string {
  // XOF has zero decimals; the registry knows, and `formatMoney` reads it.
  // Here we only need the grouped integer, which Intl gets right for fr-FR.
  return `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB").format(price.amountMinor)} ${price.currency}`;
}
