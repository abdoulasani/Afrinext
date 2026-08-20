import type { Metadata } from "next";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { catalog, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import { currencyRegistry } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * The public product page — the stable URL a seller shares.
 *
 * `findPublicProduct` returns a type that has no owner id, no store id, no
 * status and no timestamps, so there is nothing private to leak here even by
 * accident. A draft product, or one under an unpublished store, is not hidden
 * on this page: it is never fetched.
 *
 * There is no checkout. The price is shown and the purchase button says so —
 * inventing a payment flow before the milestone that builds it would be a
 * screen that lies about what the system can do.
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

  const registry = await currencyRegistry();

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
          <button
            type="button"
            disabled
            className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-contrast opacity-60"
          >
            {translate(locale, "product.buy")}
          </button>
          <p className="text-center text-xs text-muted">
            {translate(locale, "product.buySoon")}
          </p>
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
