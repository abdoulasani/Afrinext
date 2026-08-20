import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catalog, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import { currencyRegistry } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * A store's public catalogue. No session required, and none consulted.
 *
 * Everything shown comes from `listPublicProducts`, whose SQL selects only
 * published products under published stores. There is no filtering step here
 * that a future edit could forget.
 */
export default async function PublicStorePage({
  params,
}: {
  params: Promise<{ locale: string; storeSlug: string }>;
}) {
  const { locale, storeSlug } = await params;
  if (!isLocale(locale)) notFound();

  const db = getDb();
  // An unpublished, suspended or non-existent store are one answer: not found.
  const store = await catalog.findPublicStore(db, storeSlug);
  if (store === undefined) notFound();

  const products = await catalog.listPublicProducts(db, storeSlug);
  const registry = await currencyRegistry();

  return (
    <>
      <AppHeader title={store.name} subtitle={store.tagline ?? undefined} />
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        {products.length === 0 ? (
          <p className="text-sm text-muted">{translate(locale, "store.noProducts")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {products.map((product) => (
              <li key={product.slug}>
                <Link
                  href={`/${locale}/s/${storeSlug}/${product.slug}` as Route}
                  className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <span className="text-sm font-semibold">{product.title}</span>
                  <span className="text-sm tabular-nums">
                    {m.formatMoney(product.price, registry)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ storeSlug: string }>;
}): Promise<Metadata> {
  const { storeSlug } = await params;
  const store = await catalog.findPublicStore(getDb(), storeSlug);
  return store === undefined ? {} : { title: store.name };
}
