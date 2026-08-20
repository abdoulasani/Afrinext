import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { catalog, content, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import { AttachAssetForm, CreateProductForm, PublishButton } from "@/components/CatalogForms";
import {
  attachAssetAction, createProductAction, publishProductAction, publishStoreAction,
} from "@/lib/catalog-actions";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The launch market's currency. A default for the form, not a constant in logic. */
const DEFAULT_CURRENCY = "XOF";

/**
 * One store's catalogue, including drafts.
 *
 * `listStoreProducts` authorizes against this store's scope and throws if the
 * actor has no business here, so a seller who guesses another seller's slug
 * gets a 404-equivalent rather than a listing.
 */
export default async function StoreAdminPage({
  params,
}: {
  params: Promise<{ locale: string; storeSlug: string }>;
}) {
  const { locale, storeSlug } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const db = getDb();
  let store;
  let products;
  try {
    store = await catalog.findStoreBySlug(db, storeSlug);
    products = await catalog.listStoreProducts(db, actor, store.id);
  } catch {
    // Not found and not yours are answered identically: which store slugs exist
    // is not something a stranger should be able to probe.
    notFound();
  }

  const registry = await currencyRegistry();
  const published = store.status === "published";

  /*
   * The files behind each product, read through the authorized seller path.
   *
   * `listProductAssets` re-checks the store scope per product rather than
   * trusting that the listing above already did — the products came from a
   * scoped query, but a read that depends on an earlier read having been
   * correct is a read that stops being correct when the earlier one changes.
   */
  const assetsByProduct = new Map<string, content.AssetRecord[]>(
    await Promise.all(
      products.map(async (product) =>
        [product.id, await content.listProductAssets(db, actor, product.id)] as const,
      ),
    ),
  );

  return (
    <>
      <AppHeader title={store.name} back={`/${locale}/sell` as Route} />
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6">
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted">/{store.slug}</p>
          <p className="text-sm">
            {translate(
              locale,
              published ? "sell.storePublished" : "sell.storeDraft",
            )}
          </p>
          {published ? (
            <Link
              href={`/${locale}/s/${store.slug}` as Route}
              className="text-xs font-semibold text-accent underline"
            >
              {translate(locale, "sell.viewPublic")}
            </Link>
          ) : (
            <PublishButton
              locale={locale}
              storeSlug={store.slug}
              label={translate(locale, "sell.publishStore")}
              action={publishStoreAction}
            />
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {translate(locale, "sell.products")}
          </h2>
          {products.length === 0 ? (
            <p className="text-sm text-muted">{translate(locale, "sell.noProducts")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {products.map((product) => (
                <li
                  key={product.id}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold">{product.title}</span>
                    <span className="text-sm tabular-nums">
                      {m.formatMoney(product.price, registry)}
                    </span>
                  </div>
                  <span className="text-xs text-muted">
                    {translate(
                      locale,
                      product.status === "published" ? "sell.published" : "sell.draft",
                    )}
                  </span>
                  {product.status === "published" ? (
                    <Link
                      href={`/${locale}/s/${store.slug}/${product.slug}` as Route}
                      className="text-xs font-semibold text-accent underline"
                    >
                      {translate(locale, "sell.viewPublic")}
                    </Link>
                  ) : (
                    <PublishButton
                      locale={locale}
                      storeSlug={store.slug}
                      productId={product.id}
                      label={translate(locale, "sell.publish")}
                      action={publishProductAction}
                    />
                  )}

                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {translate(locale, "sell.assets")}
                    </span>
                    {(assetsByProduct.get(product.id) ?? []).length === 0 ? (
                      // Said plainly, because a published product with no file
                      // is a product a buyer pays for and receives nothing from.
                      <span data-testid={`no-assets-${product.id}`} className="text-xs text-muted">
                        {translate(locale, "sell.noAssets")}
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {(assetsByProduct.get(product.id) ?? []).map((asset) => (
                          <li key={asset.id} className="font-mono text-xs text-muted">
                            {asset.title} · {Math.max(1, Math.round(asset.byteSize / 1024))} KB
                          </li>
                        ))}
                      </ul>
                    )}
                    <AttachAssetForm
                      locale={locale}
                      storeSlug={store.slug}
                      productId={product.id}
                      labels={{
                        title: translate(locale, "sell.assetTitle"),
                        file: translate(locale, "sell.assetFile"),
                        submit: translate(locale, "sell.addAsset"),
                      }}
                      action={attachAssetAction}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {translate(locale, "sell.createProduct")}
          </h2>
          <CreateProductForm
            locale={locale}
            storeSlug={store.slug}
            currency={DEFAULT_CURRENCY}
            action={createProductAction}
            labels={{
              title: translate(locale, "sell.productTitle"),
              summary: translate(locale, "sell.productSummary"),
              price: translate(locale, "sell.price"),
              submit: translate(locale, "sell.createProduct"),
            }}
          />
        </section>
      </div>
    </>
  );
}
