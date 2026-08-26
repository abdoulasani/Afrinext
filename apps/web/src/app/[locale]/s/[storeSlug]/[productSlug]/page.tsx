import { randomUUID } from "node:crypto";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catalog, content, money as m, orders } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate, type Locale } from "@afrinext/i18n";
import {
  Badge, buttonClass, CheckIcon, PriceTag, StoreAvatar, StoreCover, StoreTypeIcon, TrustNote,
} from "@afrinext/ui";
import AppHeader from "@/components/AppHeader";
import BuyButton from "@/components/BuyButton";
import { Shell } from "@/components/Shell";
import { currencyRegistry } from "@/lib/catalog";
import { copyFor } from "@/lib/store-presentation";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The public product page — the stable URL a seller shares, and the screen
 * where money changes hands.
 *
 * ---------------------------------------------------------------------------
 * Security, unchanged
 * ---------------------------------------------------------------------------
 *
 * `findPublicProduct` returns a type with no owner id, no store id, no status
 * and no timestamps, so there is nothing private to leak here even by accident.
 * A draft product, or one under an unpublished store, is not hidden on this
 * page: it is never fetched. The buy button posts slugs and an idempotency key
 * — never a price. What the order costs is read from the catalogue on the
 * server, so the number on this page is a RENDERING of the price rather than
 * the source of it. None of that changed in this redesign, and the two extra
 * reads below are public queries this page could always have made.
 *
 * ---------------------------------------------------------------------------
 * What the page now says, and why it said almost none of it before
 * ---------------------------------------------------------------------------
 *
 * The previous version was a breadcrumb, a price, one button, a licence line
 * and nine hundred pixels of nothing. On the screen where somebody decides to
 * part with money, it answered none of the questions a buyer actually has:
 * who is selling this, what exactly do I receive, when do I receive it, what
 * happens afterwards, what else do they sell.
 *
 * So the page is now built around those questions, in that order, and every
 * answer is one Afrinext can stand behind:
 *
 *   the plate       the seller's identity, not a stock photograph
 *   the seller      a real card linking to a real storefront
 *   what you get    three statements that are true of the domain
 *   the licence     the seller's own words, or an explicit "none stated"
 *   more from them  their other published offerings
 *
 * There is no rating, no review count, no "127 people bought this", no
 * countdown and no fake scarcity. Afrinext has none of those facts, and the
 * screen where trust is being decided is the last place to invent one.
 */
export default async function PublicProductPage({
  params,
}: {
  params: Promise<{ locale: string; storeSlug: string; productSlug: string }>;
}) {
  const { locale, storeSlug, productSlug } = await params;
  if (!isLocale(locale)) notFound();

  const db = getDb();
  const product = await catalog.findPublicProduct(db, storeSlug, productSlug);
  if (product === undefined) notFound();

  const [registry, actor, licence, store, siblings] = await Promise.all([
    currencyRegistry(),
    currentActor(),
    // The terms of sale, before the sale. Terms nobody can read before paying
    // are not terms.
    content.publicLicenceFor(db, storeSlug, productSlug),
    // The seller's public identity. A second public read rather than a change
    // to `findPublicProduct`, which deliberately returns nothing but the
    // product; the store query already refuses anything unpublished.
    catalog.findPublicStore(db, storeSlug),
    catalog.listPublicProducts(db, storeSlug),
  ]);

  // What someone already owns is read from `entitlements`, never inferred from
  // an order's status at read time.
  const owned =
    actor !== undefined &&
    (await orders.listOwnEntitlements(db, actor)).some(
      (e) => e.storeSlug === storeSlug && e.productSlug === productSlug,
    );

  const others = siblings.filter((p) => p.slug !== productSlug).slice(0, 4);
  const brand = store?.brand ?? "laterite";
  const storeType = store?.storeType ?? "digital_product";
  const price = m.formatMoney(product.price, registry);

  return (
    <>
      {/* `titleAs="p"`: this page sets its own <h1> beside the price, and one
          document gets one top-level heading. */}
      <AppHeader
        title={product.title}
        titleAs="p"
        back={`/${locale}/s/${storeSlug}` as Route}
      />

      <Shell width="wide">
        {/*
         * Room for the purchase bar, which is fixed and which `Shell` knows
         * nothing about — its own padding clears the tab bar and no more.
         * Without this the licence and the related offerings slid underneath
         * it and the last thing a buyer read was cut in half.
         */}
        <div className="pb-24 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10 lg:px-6 lg:pt-8 lg:pb-0">
          {/* ================= left: the thing itself ================= */}
          <div className="min-w-0">
            {/*
             * The plate.
             *
             * Afrinext has no product images yet, and the honest answer to that
             * is not a grey rectangle with a camera glyph — which reads as
             * broken — nor a stock photograph, which says something untrue
             * about what is being sold. It is the seller's own identity, deep
             * and lit, carrying the mark of what kind of thing this is. The day
             * uploads land, a photograph goes here and nothing else moves.
             */}
            <StoreCover
              brand={brand}
              className="h-52 sm:h-64 lg:h-80 lg:rounded-[var(--radius-xl)]"
            >
              <div className="flex h-full flex-col justify-between p-5">
                <Badge tone="onInk">
                  <StoreTypeIcon type={storeType} className="h-3.5 w-3.5" />
                  {translate(locale, copyFor(storeType).singular)}
                </Badge>
                <StoreTypeIcon
                  type={storeType}
                  className="mx-auto h-16 w-16 text-[var(--on-ink)] opacity-40"
                />
                <span aria-hidden="true" />
              </div>
            </StoreCover>

            <div className="px-4 pt-6 sm:px-6 lg:px-0">
              <h1 className="text-h1 text-foreground">{product.title}</h1>

              {product.summary !== null && product.summary !== "" && (
                <p className="mt-3 max-w-[60ch] text-body text-muted">{product.summary}</p>
              )}

              <SellerCard locale={locale} storeSlug={storeSlug} store={store}
                storeName={product.storeName} />

              {product.description !== null && product.description.trim() !== "" && (
                <section aria-labelledby="about-heading" className="mt-8">
                  <h2 id="about-heading" className="text-h3 text-foreground">
                    {translate(locale, "product.about")}
                  </h2>
                  <div className="mt-2 max-w-[68ch] whitespace-pre-line text-body text-muted">
                    {product.description}
                  </div>
                </section>
              )}

              <WhatYouGet locale={locale} versionNo={licence?.versionNo} />

              <Licence locale={locale} licenceText={licence?.licenceText ?? null} />
            </div>
          </div>

          {/* ================= right: the decision ================= */}
          <aside className="mt-8 px-4 sm:px-6 lg:sticky lg:top-24 lg:mt-0 lg:self-start lg:px-0">
            {/*
             * ONE purchase control, in one place in the DOM.
             *
             * It was two: a panel for the laptop and a fixed bar for the phone,
             * rendering the same three states from the same function. That
             * looked tidy and was not — every test id on the page then existed
             * twice, so a strict locator matched two buttons and could not
             * choose. The duplicate ids were the symptom; the real problem is
             * that two controls which must never disagree about whether
             * somebody may buy are better as one control that cannot.
             *
             * So: a single block, pinned above the tab bar on a phone and
             * released into the sticky sidebar from `lg` up. The arrangement is
             * CSS; the control is one node.
             */}
            <div
              className={
                "fixed inset-x-0 bottom-0 z-30 border-t border-border " +
                "bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur-xl " +
                "lg:static lg:rounded-[var(--radius-lg)] lg:border lg:bg-surface " +
                "lg:p-5 lg:shadow-[var(--shadow-md)] lg:backdrop-blur-none lg:pb-5"
              }
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 62px)" }}
            >
              <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3 lg:block lg:max-w-none lg:px-0 lg:py-0">
                <div className="shrink-0">
                  <p className="text-label uppercase text-muted">
                    {translate(locale, "product.priceLabel")}
                  </p>
                  <PriceTag
                    amount={price}
                    size="md"
                    className="mt-0.5 whitespace-nowrap lg:hidden"
                    data-testid="product-price"
                  />
                  <PriceTag amount={price} size="xl" className="mt-1.5 hidden lg:inline-flex" />
                </div>
                <div className="ml-auto min-w-0 lg:ml-0 lg:mt-5">
                  <BuyArea
                    locale={locale} actor={actor} owned={owned}
                    storeSlug={storeSlug} productSlug={productSlug}
                  />
                </div>
              </div>
            </div>

            {others.length > 0 && (
              <section aria-labelledby="more-heading" className="mt-10 lg:mt-8">
                <h2 id="more-heading" className="text-h3 text-foreground">
                  {translate(locale, "product.moreFromStore")}
                </h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {others.map((p) => (
                    <li key={p.slug}>
                      <Link
                        href={`/${locale}/s/${storeSlug}/${p.slug}` as Route}
                        className={
                          "flex items-center gap-3 rounded-[var(--radius-md)] border " +
                          "border-border bg-surface p-3 transition-colors " +
                          "duration-[var(--duration-fast)] hover:border-border-strong " +
                          "hover:bg-surface-muted"
                        }
                      >
                        <span
                          data-brand={brand}
                          aria-hidden="true"
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--brand-deep)] text-[var(--on-ink)]"
                        >
                          <StoreTypeIcon type={storeType} className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-small font-semibold text-foreground">
                            {p.title}
                          </span>
                          <PriceTag
                            amount={m.formatMoney(p.price, registry)}
                            size="sm"
                            className="mt-0.5"
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </Shell>
    </>
  );
}

/* ========================================================================= */

/**
 * The one action, in whichever of its three states applies.
 *
 * Rendered once. Which of the three states applies stays a server-side
 * decision made by the same reads as before; this only chooses which control
 * to draw.
 */
function BuyArea({
  locale, actor, owned, storeSlug, productSlug,
}: {
  locale: Locale;
  actor: { userId: string } | undefined;
  owned: boolean;
  storeSlug: string;
  productSlug: string;
}) {
  if (actor === undefined) {
    return (
      <a
        href={`/${locale}/sign-in`}
        data-testid="sign-in-to-buy"
        className={buttonClass("solid", "lg", "w-full")}
      >
        {translate(locale, "order.signInToBuy")}
      </a>
    );
  }
  if (owned) {
    return (
      <div className="flex flex-col gap-2">
        <p data-testid="already-owned" className="text-small font-medium text-accent">
          {translate(locale, "order.owned")}
        </p>
        <a
          href={`/${locale}/library/${storeSlug}/${productSlug}`}
          data-testid="open-library"
          className={buttonClass("outline", "lg", "w-full")}
        >
          {translate(locale, "order.openLibrary")}
        </a>
      </div>
    );
  }
  return (
    <BuyButton
      locale={locale}
      storeSlug={storeSlug}
      productSlug={productSlug}
      /*
       * Minted per render, so two taps on this page resolve to one order while
       * a later visit may start a new one.
       */
      checkoutKey={randomUUID()}
      label={translate(locale, "product.buy")}
      fullWidth
    />
  );
}

/** Who is selling this, as a real identity rather than a line of grey text. */
function SellerCard({
  locale, storeSlug, store, storeName,
}: {
  locale: Locale;
  storeSlug: string;
  store: catalog.PublicStore | undefined;
  storeName: string;
}) {
  const brand = store?.brand ?? "laterite";
  return (
    <Link
      href={`/${locale}/s/${storeSlug}` as Route}
      className={
        "mt-6 flex items-center gap-3 rounded-[var(--radius-lg)] border border-border " +
        "bg-surface p-3.5 transition-[border-color,box-shadow] " +
        "duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-[var(--shadow-md)]"
      }
    >
      <StoreAvatar name={storeName} brand={brand} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block text-label uppercase text-muted">
          {translate(locale, "product.seller")}
        </span>
        <span className="mt-0.5 block truncate text-h3 text-foreground">{storeName}</span>
      </span>
      <span className="shrink-0 text-small font-semibold text-copper">
        {translate(locale, "product.visitStore")}
      </span>
    </Link>
  );
}

/**
 * What a buyer receives, in three statements that are true of the system.
 *
 * Each line maps to behaviour that exists: fulfilment opens access on a
 * confirmed payment; the entitlement pins the version bought; the library is
 * where the file lives afterwards. Nothing here is a marketing claim, and the
 * version line is omitted entirely rather than guessed at when the product has
 * no published version to name.
 */
function WhatYouGet({ locale, versionNo }: { locale: Locale; versionNo?: number }) {
  return (
    <section aria-labelledby="get-heading" className="mt-8">
      <h2 id="get-heading" className="text-h3 text-foreground">
        {translate(locale, "product.whatYouGet")}
      </h2>
      <div className="mt-3 flex flex-col gap-2.5">
        <TrustNote icon={<CheckIcon />} tone="confirmed">
          {translate(locale, "product.accessImmediate")}
        </TrustNote>
        {versionNo !== undefined && (
          <TrustNote icon={<CheckIcon />}>
            {translate(locale, "product.accessVersion", { n: versionNo })}
          </TrustNote>
        )}
        <TrustNote icon={<CheckIcon />}>
          {translate(locale, "product.accessLibrary")}
        </TrustNote>
      </div>
    </section>
  );
}

/**
 * The seller's licence, shown before the buy button is pressed.
 *
 * Afrinext writes none of this and adds no default: when a seller has stated
 * nothing, the page says so rather than implying terms that do not exist. What
 * the buyer sees here is copied into their entitlement at payment, so this is
 * also exactly what they will keep.
 */
function Licence({ locale, licenceText }: { locale: Locale; licenceText: string | null }) {
  const stated = licenceText !== null && licenceText.trim() !== "";
  return (
    <section
      aria-labelledby="licence-heading"
      data-testid="product-licence"
      className="mt-8 rounded-[var(--radius-lg)] border border-border bg-surface-muted/60 p-5"
    >
      <h2 id="licence-heading" className="text-h3 text-foreground">
        {translate(locale, "product.licence")}
      </h2>
      <p className="mt-1 text-caption text-faint">
        {translate(locale, "product.licenceIntro")}
      </p>
      {stated ? (
        <p className="mt-3 max-w-[68ch] whitespace-pre-line text-small text-muted">
          {licenceText}
        </p>
      ) : (
        <p className="mt-3 text-small text-muted">
          {translate(locale, "product.licenceNone")}
        </p>
      )}
    </section>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ storeSlug: string; productSlug: string }>;
}): Promise<Metadata> {
  const { storeSlug, productSlug } = await params;
  const product = await catalog.findPublicProduct(getDb(), storeSlug, productSlug);
  if (product === undefined) return {};
  return {
    title: product.title,
    ...(product.summary !== null ? { description: product.summary } : {}),
  };
}
