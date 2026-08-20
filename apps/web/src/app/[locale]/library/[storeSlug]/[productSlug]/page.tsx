import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { content } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import AssetList from "@/components/AssetList";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A purchased product, and the files behind it.
 *
 * `findEntitledProduct` resolves the product THROUGH the buyer's entitlement,
 * so a product this person has not bought does not render a page they cannot
 * use — it does not resolve at all, and this is a 404. Knowing the URL is not
 * an argument the server accepts.
 */
export default async function LibraryProductPage({
  params,
}: {
  params: Promise<{ locale: string; storeSlug: string; productSlug: string }>;
}) {
  const { locale, storeSlug, productSlug } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const product = await content
    .findEntitledProduct(getDb(), actor, storeSlug, productSlug)
    .catch(() => undefined);
  if (product === undefined) notFound();

  return (
    <>
      <AppHeader title={product.title} back={`/${locale}/orders` as Route} />
      <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
        {product.deliveryMode === "view_only" && (
          <p data-testid="view-only" className="text-xs text-muted">
            {translate(locale, "library.viewOnly")}
          </p>
        )}

        {product.assets.length === 0 ? (
          <p className="text-sm text-muted">{translate(locale, "library.noAssets")}</p>
        ) : (
          <AssetList
            storeSlug={storeSlug}
            productSlug={productSlug}
            deliveryMode={product.deliveryMode}
            assets={product.assets.map((a) => ({
              id: a.id, title: a.title, contentType: a.contentType, byteSize: a.byteSize,
            }))}
            labels={{
              download: translate(locale, "library.download"),
              view: translate(locale, "library.view"),
              failed: translate(locale, "error.generic"),
            }}
          />
        )}

        {/* The boundary, still stated on the screen a buyer actually reaches. */}
        <p className="border-t border-border pt-4 text-xs text-muted">
          {translate(locale, "library.notSettled")}
        </p>
      </div>
    </>
  );
}
