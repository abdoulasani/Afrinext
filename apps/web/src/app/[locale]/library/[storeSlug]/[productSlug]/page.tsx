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
      <AppHeader title={product.title} back={`/${locale}/library` as Route} />
      <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
        {product.deliveryMode === "view_only" && (
          <p data-testid="view-only" className="text-xs text-muted">
            {translate(locale, "library.viewOnly")}
          </p>
        )}

        {/*
          * What was bought, not what the product is now. The seller may have
          * published three versions since; this buyer owns one of them, and the
          * page says which.
          */}
        <p data-testid="purchased-version" className="text-xs text-muted">
          {translate(locale, "library.version", { n: product.versionNo })}
        </p>

        {/*
          * A newer version exists. Said, not offered.
          *
          * Review decision, phase 5: pinned, with newer versions visible. The
          * buyer keeps what they paid for; knowing the seller has moved on is
          * the difference between "my file is out of date" and "this was
          * abandoned". The second sentence is the important one — without it
          * this reads like an upgrade is about to happen, and Afrinext has
          * decided no such policy.
          */}
        {product.latestVersionNo > product.versionNo && (
          <div
            data-testid="newer-version"
            className="rounded-[var(--radius-md)] border border-border bg-surface-muted px-3.5 py-3"
          >
            <p className="text-[13px] font-semibold text-foreground">
              {translate(locale, "library.newerVersion", { n: product.latestVersionNo })}
            </p>
            <p className="mt-1 text-xs text-muted">
              {translate(locale, "library.newerVersionNote", { bought: product.versionNo })}
            </p>
          </div>
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
              downloadsRemaining: a.downloadsRemaining,
              // Translated and pluralised here, where the catalogue lives.
              remainingLabel:
                a.downloadsRemaining === null
                  ? translate(locale, "library.unlimited")
                  : a.downloadsRemaining === 0
                    ? translate(locale, "library.exhausted")
                    : translate(locale, "library.remaining", { count: a.downloadsRemaining }),
            }))}
            labels={{
              download: translate(locale, "library.download"),
              view: translate(locale, "library.view"),
              failed: translate(locale, "error.generic"),
            }}
          />
        )}

        {/*
          * The licence AS AGREED, from the entitlement's own snapshot — not the
          * product's current terms. If the seller rewrote them last week, this
          * buyer still sees what they accepted.
          */}
        <section aria-labelledby="licence-heading" data-testid="licence">
          <h2 id="licence-heading" className="text-sm font-semibold">
            {translate(locale, "library.licence")}
          </h2>
          {product.licenceSnapshot === null || product.licenceSnapshot.trim() === "" ? (
            <p className="mt-1 text-sm text-muted">
              {translate(locale, "library.licenceNone")}
            </p>
          ) : (
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">
              {product.licenceSnapshot}
            </p>
          )}
        </section>

        {/* The boundary, still stated on the screen a buyer actually reaches. */}
        <p className="border-t border-border pt-4 text-xs text-muted">
          {translate(locale, "library.notSettled")}
        </p>
      </div>
    </>
  );
}
