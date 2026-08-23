import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catalog, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { buttonClass, Card, EmptyState, StoreAvatar, StoreCover, StoreTypeIcon } from "@afrinext/ui";
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
 * Nothing here is fabricated. There is no rating, no review count, no
 * follower total and no "verified" badge, because Afrinext has none of those
 * facts. A buyer deciding whether to trust a seller in Niamey is exactly the
 * wrong person to show an invented number to.
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

  return (
    <Shell width="wide">
      {/* ---------- Identity ---------- */}
      <header>
        <StoreCover brand={store.brand} className="h-36 sm:h-52 lg:h-64" />

        {/*
          * `relative z-10` is load-bearing.
          *
          * `StoreCover` is positioned, so without a stacking context of its
          * own this block renders UNDERNEATH it and the monogram is sliced in
          * half by the cover's bottom edge.
          */}
        <div className="relative z-10 px-4 sm:px-5">
          <div className="-mt-10 flex items-end gap-3 sm:-mt-12">
            <StoreAvatar name={store.name} brand={store.brand} size="lg" />
            <span
              data-brand={store.brand}
              className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--brand)]"
            >
              <StoreTypeIcon type={store.storeType} className="h-4 w-4" />
              {translate(locale, copy.singular)}
            </span>
          </div>

          <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
            {store.name}
          </h1>
          {store.tagline !== null && store.tagline !== "" && (
            <p className="mt-1.5 max-w-[58ch] text-[15px] leading-relaxed text-muted">
              {store.tagline}
            </p>
          )}

          <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted">
            {place !== null && (
              <div className="inline-flex items-center gap-1.5">
                <dt className="sr-only">{translate(locale, "store.location")}</dt>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
                  strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <dd>{place}</dd>
              </div>
            )}
            {since !== null && (
              <div className="inline-flex items-center gap-1.5">
                <dt className="sr-only">{translate(locale, "store.memberSince", { date: "" })}</dt>
                <dd>{translate(locale, "store.memberSince", { date: since })}</dd>
              </div>
            )}
          </dl>

          {/*
            * A public contact the owner entered for buyers. Never their
            * sign-in number, which authenticates a person and is not a
            * business detail.
            */}
          {store.contactPhone !== null && store.contactPhone !== "" && (
            <a
              href={`tel:${store.contactPhone.replace(/\s+/g, "")}`}
              className={buttonClass("secondary", "md", "mt-4")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
                strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <path d="M4 5.5C4 4.7 4.7 4 5.5 4h2.2c.7 0 1.3.5 1.5 1.2l.7 3a1.5 1.5 0 0 1-.5 1.5l-1.3 1a12 12 0 0 0 5.2 5.2l1-1.3a1.5 1.5 0 0 1 1.5-.5l3 .7c.7.2 1.2.8 1.2 1.5v2.2c0 .8-.7 1.5-1.5 1.5A15.5 15.5 0 0 1 4 5.5Z" />
              </svg>
              {translate(locale, "store.contact")}
            </a>
          )}
        </div>
      </header>

      {/* ---------- Offerings, named for the trade ---------- */}
      <section className="px-4 pt-8 sm:px-5" aria-labelledby="offerings-heading">
        <h2 id="offerings-heading" className="text-lg font-semibold tracking-tight text-foreground">
          {translate(locale, copy.offerings)}
        </h2>

        {products.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<StoreTypeIcon type={store.storeType} className="h-6 w-6" />}
              title={translate(locale, "store.emptyOfferingsTitle")}
              body={translate(locale, "store.emptyOfferingsBody")}
            />
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <Card as="li" key={product.slug} interactive className="overflow-hidden">
                <Link
                  href={`/${locale}/s/${storeSlug}/${product.slug}` as Route}
                  className="flex h-full flex-col p-4"
                >
                  <h3 className="text-[15px] font-semibold leading-snug text-foreground">
                    {product.title}
                  </h3>
                  {product.summary !== null && product.summary !== "" && (
                    <p className="mt-1.5 line-clamp-3 flex-1 text-[13px] leading-relaxed text-muted">
                      {product.summary}
                    </p>
                  )}
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-semibold tabular-nums text-primary">
                      {m.formatMoney(product.price, registry)}
                    </span>
                    <span className="text-[13px] font-medium text-muted">
                      {translate(locale, "store.viewOffering")} →
                    </span>
                  </div>
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- About ---------- */}
      {store.description !== null && store.description.trim() !== "" && (
        <section className="px-4 pt-8 sm:px-5" aria-labelledby="about-heading">
          <h2 id="about-heading" className="text-lg font-semibold tracking-tight text-foreground">
            {translate(locale, "store.about")}
          </h2>
          <div className="mt-2 max-w-[68ch] whitespace-pre-line text-[15px] leading-relaxed text-muted">
            {store.description}
          </div>
        </section>
      )}
    </Shell>
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
