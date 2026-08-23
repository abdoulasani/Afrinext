import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { catalog, content, money as m, orders } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import BuyButton from "@/components/BuyButton";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The public product page — the stable URL a seller shares.
 *
 * `findPublicProduct` returns a type that has no owner id, no store id, no
 * status and no timestamps, so there is nothing private to leak here even by
 * accident. A draft product, or one under an unpublished store, is not hidden
 * on this page: it is never fetched.
 *
 * The buy button posts slugs and an idempotency key — never a price. What the
 * order costs is read from the catalogue on the server, so the number on this
 * page is a rendering of the price rather than the source of it.
 */
export default async function PublicProductPage({
  params,
}: {
  params: Promise<{ locale: string; storeSlug: string; productSlug: string }>;
}) {
  const { locale, storeSlug, productSlug } = await params;
  if (!isLocale(locale)) notFound();

  const product = await catalog.findPublicProduct(getDb(), storeSlug, productSlug);
  if (product === undefined) notFound();

  const [registry, actor, licence] = await Promise.all([
    currencyRegistry(),
    currentActor(),
    // The terms of sale, before the sale. Terms nobody can read before paying
    // are not terms.
    content.publicLicenceFor(getDb(), storeSlug, productSlug),
  ]);
  // What someone already owns is read from `entitlements`, never inferred from
  // an order's status at read time.
  const owned =
    actor !== undefined &&
    (await orders.listOwnEntitlements(getDb(), actor)).some(
      (e) => e.storeSlug === storeSlug && e.productSlug === productSlug,
    );

  return (
    <>
      <AppHeader title={product.title} back={`/${locale}/s/${storeSlug}` as Route} />
      <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
        <section className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-muted">
            {translate(locale, "store.by")} · {product.storeName}
          </p>
          <p data-testid="product-price" className="text-3xl font-semibold tabular-nums">
            {m.formatMoney(product.price, registry)}
          </p>
        </section>

        {product.summary !== null && <p className="text-sm">{product.summary}</p>}
        {product.description !== null && (
          <p className="whitespace-pre-line text-sm text-muted">{product.description}</p>
        )}

        <section className="flex flex-col gap-2 border-t border-border pt-5">
          {actor === undefined ? (
            <a
              href={`/${locale}/sign-in`}
              data-testid="sign-in-to-buy"
              className="w-full rounded-full bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-contrast"
            >
              {translate(locale, "order.signInToBuy")}
            </a>
          ) : owned ? (
            <>
              <p data-testid="already-owned" className="text-sm font-medium">
                {translate(locale, "order.owned")}
              </p>
              <a
                href={`/${locale}/library/${storeSlug}/${productSlug}`}
                data-testid="open-library"
                className="w-full rounded-full bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-contrast"
              >
                {translate(locale, "order.openLibrary")}
              </a>
            </>
          ) : (
            <BuyButton
              locale={locale}
              storeSlug={storeSlug}
              productSlug={productSlug}
              /*
               * Minted per render, so two taps on this page resolve to one
               * order while a later visit may start a new one.
               */
              checkoutKey={randomUUID()}
              label={translate(locale, "product.buy")}
            />
          )}
        </section>

        {/*
          * The seller's licence, shown before the buy button is pressed.
          *
          * Afrinext writes none of this and adds no default: when a seller has
          * stated nothing, the page says so rather than implying terms that do
          * not exist. What the buyer sees here is copied into their entitlement
          * at payment, so this is also exactly what they will keep.
          */}
        <section aria-labelledby="licence-heading" data-testid="product-licence"
          className="border-t border-border pt-4">
          <h2 id="licence-heading" className="text-sm font-semibold">
            {translate(locale, "product.licence")}
          </h2>
          {licence?.licenceText === undefined || licence.licenceText === null
            || licence.licenceText.trim() === "" ? (
            <p className="mt-1 text-sm text-muted">
              {translate(locale, "product.licenceNone")}
            </p>
          ) : (
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">
              {licence.licenceText}
            </p>
          )}
        </section>
      </div>
    </>
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
