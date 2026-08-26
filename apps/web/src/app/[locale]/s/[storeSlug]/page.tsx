import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catalog, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import {
  Badge, buttonClass, EmptyState, PriceTag, SectionHeader,
  StoreAvatar, StoreCover, StoreTypeIcon,
} from "@afrinext/ui";
import { Shell } from "@/components/Shell";
import { countryNames, currencyRegistry } from "@/lib/catalog";
import { copyFor, locationLabel } from "@/lib/store-presentation";

export const dynamic = "force-dynamic";

/**
 * A store's public page. No session required, and none consulted.
 *
 * The store's TYPE changes what a visitor reads — a formation's offerings are
 * "Formations", a mechanic's are "Prestations" — but never what is fetched.
 * One query, one layout, six vocabularies: that is what makes the engine
 * universal rather than six pages wearing a trench coat.
 *
 * ---------------------------------------------------------------------------
 * Why the identity block is built the way it is
 * ---------------------------------------------------------------------------
 *
 * The previous version spent the first third of a phone screen on a cover band
 * that said nothing, then set the store's TYPE in a bright pill louder than the
 * store's own name. A storefront's job is to say whose shop this is, so the
 * order is now: name at heading size, tagline, then the facts that let somebody
 * judge — where they are, what they sell, how many things, since when — as one
 * quiet line rather than four competing chips.
 *
 * The cover carries the name itself on larger screens, which is what makes the
 * page read as a storefront rather than as a record with a banner on top.
 *
 * ---------------------------------------------------------------------------
 * What is NOT here
 * ---------------------------------------------------------------------------
 *
 * No rating, no review count, no follower total, no "verified" badge, no
 * response time, no sales figure. Afrinext has none of those facts. A buyer
 * deciding whether to trust a seller in Niamey is exactly the wrong person to
 * show an invented number to, and the empty state below says a store is new
 * rather than dressing it up as busy.
 */
export default async function PublicStorePage({
  params,
}: {
  params: Promise<{ locale: string; storeSlug: string }>;
}) {
  const { locale, storeSlug } = await params;
  if (!isLocale(locale)) notFound();

  const db = getDb();
  // Unpublished, suspended and non-existent are one answer, in SQL.
  const store = await catalog.findPublicStore(db, storeSlug);
  if (store === undefined) notFound();

  const [products, registry, countries] = await Promise.all([
    catalog.listPublicProducts(db, storeSlug),
    currencyRegistry(),
    countryNames(locale),
  ]);

  const copy = copyFor(store.storeType);
  const place = locationLabel(
    store.city,
    store.countryCode === null ? null : countries[store.countryCode] ?? store.countryCode,
  );
  const since =
    store.publishedAt === null
      ? null
      : new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
          month: "long", year: "numeric",
        }).format(store.publishedAt);

  // The lowest published price, computed from rows that exist. Shown only when
  // there is something to compute it from — never as "À partir de —".
  const cheapest = products.reduce<typeof products[number] | undefined>(
    (low, p) => (low === undefined || p.price.amountMinor < low.price.amountMinor ? p : low),
    undefined,
  );

  return (
    <Shell width="wide">
      {/* ================= identity ================= */}
      <header>
        {/*
         * The cover carries the identity and the trade, and NOT the name.
         *
         * The first draft set the name on the cover from `sm` up and repeated
         * it below for phones, swapping them with CSS. Both were in the DOM at
         * every width, so the page had two `<h1>`s saying the same words — a
         * screen-reader user navigating by heading heard the shop announce
         * itself twice with no way to tell which was the content. One heading,
         * below, sized up on wider screens.
         */}
        <StoreCover brand={store.brand} scrim className="h-32 sm:h-56 lg:h-72">
          <div className="flex h-full items-start justify-end p-4 sm:p-6">
            <Badge tone="onInk">
              <StoreTypeIcon type={store.storeType} className="h-3.5 w-3.5" />
              {translate(locale, copy.singular)}
            </Badge>
          </div>
        </StoreCover>

        {/*
         * `relative z-10` is load-bearing.
         *
         * `StoreCover` is positioned, so without a stacking context of its own
         * this block renders UNDERNEATH it and the monogram is sliced in half
         * by the cover's bottom edge.
         */}
        <div className="relative z-10 px-4 sm:px-6">
          <div className="-mt-8 flex items-end gap-3.5">
            <StoreAvatar name={store.name} brand={store.brand} size="lg" ring />
          </div>

          <h1 className="mt-4 text-h1 text-foreground sm:text-display">{store.name}</h1>

          {store.tagline !== null && store.tagline !== "" && (
            <p className="mt-2 max-w-[58ch] text-body text-muted">{store.tagline}</p>
          )}

          {/*
           * The facts, as one line of quiet metadata separated by dots.
           *
           * Four chips in four colours was the old version, and it made the
           * page look like a dashboard. Everything here is counted or stored;
           * anything absent is simply not printed.
           */}
          <dl className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
            {/* Omitted at zero rather than printed as "no offerings yet":
                the empty state below says exactly that, and saying it twice on
                one screen makes neither statement count. */}
            {products.length > 0 && (
              <Fact label={translate(locale, "store.offerings")}>
                {translate(locale, "store.offeringsCount", { count: products.length })}
              </Fact>
            )}
            {place !== null && (
              <Fact label={translate(locale, "store.location")}>{place}</Fact>
            )}
            {since !== null && (
              <Fact label={translate(locale, "store.memberSince", { date: "" })}>
                {translate(locale, "store.memberSince", { date: since })}
              </Fact>
            )}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {cheapest !== undefined && (
              <p className="flex items-baseline gap-2">
                <span className="text-label uppercase text-muted">
                  {translate(locale, "store.fromPrice")}
                </span>
                <PriceTag amount={m.formatMoney(cheapest.price, registry)} size="lg" />
              </p>
            )}
            {/*
             * A public contact the owner entered for buyers. Never their
             * sign-in number, which authenticates a person and is not a
             * business detail.
             */}
            {store.contactPhone !== null && store.contactPhone !== "" && (
              <a
                href={`tel:${store.contactPhone.replace(/\s+/g, "")}`}
                className={buttonClass("outline", "md", "ml-auto")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
                  strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <path d="M4 5.5C4 4.7 4.7 4 5.5 4h2.2c.7 0 1.3.5 1.5 1.2l.7 3a1.5 1.5 0 0 1-.5 1.5l-1.3 1a12 12 0 0 0 5.2 5.2l1-1.3a1.5 1.5 0 0 1 1.5-.5l3 .7c.7.2 1.2.8 1.2 1.5v2.2c0 .8-.7 1.5-1.5 1.5A15.5 15.5 0 0 1 4 5.5Z" />
                </svg>
                {translate(locale, "store.contact")}
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ================= offerings, named for the trade ================= */}
      <section className="px-4 pt-10 sm:px-6" aria-labelledby="offerings-heading">
        <SectionHeader
          id="offerings-heading"
          title={translate(locale, copy.offerings)}
          {...(products.length > 0
            ? { body: translate(locale, "store.offeringsCount", { count: products.length }) }
            : {})}
        />

        {products.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              icon={<StoreTypeIcon type={store.storeType} className="h-6 w-6" />}
              title={translate(locale, "store.emptyOfferingsTitle")}
              body={translate(locale, "store.emptyOfferingsBody")}
            />
          </div>
        ) : (
          /*
           * Two columns on a phone, and that is the single biggest change here.
           *
           * The old grid was one full-width bordered card per offering, so a
           * store with six things was six screens of scrolling and a buyer
           * could never see two prices at once — which is exactly the
           * comparison they came to make.
           */
          <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 lg:grid-cols-4">
            {products.map((product) => (
              <li key={product.slug} className="group">
                <Link
                  href={`/${locale}/s/${storeSlug}/${product.slug}` as Route}
                  className="block focus-visible:outline-none"
                >
                  <div
                    data-brand={store.brand}
                    className={
                      "relative isolate aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] " +
                      "bg-[var(--brand-deep)] transition-transform " +
                      "duration-[var(--duration-base)] ease-[var(--ease-out)] " +
                      "group-hover:-translate-y-[3px] group-focus-visible:-translate-y-[3px]"
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0"
                      style={{
                        backgroundImage: "var(--brand-motif)",
                        backgroundSize: "var(--brand-motif-size, auto)",
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 opacity-70"
                      style={{
                        backgroundImage:
                          "radial-gradient(ellipse 90% 120% at 12% -8%, var(--brand), transparent 62%)",
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 grid place-items-center text-[var(--on-ink)] opacity-90"
                    >
                      <StoreTypeIcon type={store.storeType} className="h-8 w-8" />
                    </span>
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-h3 text-foreground">{product.title}</h3>
                  {product.summary !== null && product.summary !== "" && (
                    <p className="mt-1 line-clamp-2 text-caption text-muted">{product.summary}</p>
                  )}
                  <PriceTag
                    amount={m.formatMoney(product.price, registry)}
                    size="md"
                    className="mt-2"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ================= about ================= */}
      {store.description !== null && store.description.trim() !== "" && (
        <section className="px-4 pt-12 sm:px-6" aria-labelledby="about-heading">
          <SectionHeader id="about-heading" title={translate(locale, "store.aboutSeller")} />
          <div className="mt-4 max-w-[68ch] whitespace-pre-line text-body text-muted">
            {store.description}
          </div>
        </section>
      )}
    </Shell>
  );
}

/**
 * One metadata fact, labelled for a screen reader and quiet on screen.
 *
 * The separating dot is generated BEFORE each fact after the first, rather than
 * placed between them as its own element. A standalone dot is a flex item that
 * can wrap onto the end of a line and sit there alone, which is exactly what it
 * did: "Maradi, Niger ·" then a line break. Attached to the item it introduces,
 * it cannot be orphaned.
 */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className={
        "inline-flex items-center gap-2 " +
        "before:text-faint before:content-['·'] first:before:content-none"
      }
    >
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ storeSlug: string }>;
}): Promise<Metadata> {
  const { storeSlug } = await params;
  const store = await catalog.findPublicStore(getDb(), storeSlug);
  if (store === undefined) return {};
  return {
    title: store.name,
    ...(store.tagline !== null ? { description: store.tagline } : {}),
  };
}
