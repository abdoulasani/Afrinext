import { sql } from "drizzle-orm";
import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { catalog, content, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate, type MessageKey } from "@afrinext/i18n";
import { Badge, buttonClass, Card, EmptyState, StoreAvatar, StoreCover, StoreTypeIcon } from "@afrinext/ui";
import AppHeader from "@/components/AppHeader";
import ProductDelivery from "@/components/ProductDelivery";
import { AttachAssetForm, CreateProductForm, PublishButton } from "@/components/CatalogForms";
import { Shell } from "@/components/Shell";
import {
  attachAssetAction, createProductAction, publishProductAction, publishStoreAction,
  publishVersionAction, setDownloadLimitAction, setLicenceAction,
} from "@/lib/catalog-actions";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";
import { copyFor } from "@/lib/store-presentation";

export const dynamic = "force-dynamic";

/** The launch market's currency. A default for the form, not a constant in logic. */
const DEFAULT_CURRENCY = "XOF";

/**
 * One store's workspace.
 *
 * Built around a single question — what should this seller do next? — because
 * an entrepreneur opening their first shop does not arrive knowing that a
 * store must be published before a product can be, or that a digital product
 * without a file sells nothing. The guidance strip at the top answers that
 * question in one sentence and gives it a button.
 *
 * Sections adapt to the store's type in their WORDING only. A formation's
 * offerings are "Formations" and a mechanic's are "Prestations", but both read
 * the same table through the same authorized query. Sections belonging to
 * later milestones — orders, customers, analytics — are shown as explicitly
 * disabled rather than hidden, so the shape of the product is legible, and
 * they display no numbers at all: an empty metric card is a fabricated metric
 * card waiting to happen.
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
  const suspended = store.status === "suspended";
  const copy = copyFor(store.storeType);

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

  /*
   * Versions, per product. Read through `listProductVersions`, which authorizes
   * on the product's own store — so this page cannot show a version belonging
   * to a store the actor does not administer even if the query were wrong.
   */
  const versionsByProduct = new Map<string, content.ProductVersion[]>(
    await Promise.all(
      products.map(async (product) =>
        [product.id, await content.listProductVersions(db, actor, product.id)] as const,
      ),
    ),
  );

  // The download limit lives on the product row and is not part of ProductRecord.
  const limitRows = await db.execute<{
    [key: string]: unknown; id: string; download_limit: number | null;
  }>(sql`
    select id, download_limit from products where store_id = ${store.id}::uuid
  `);
  const limitByProduct = new Map(
    limitRows.rows.map((r) => [r.id, r.download_limit === null ? null : Number(r.download_limit)]),
  );

  /*
   * The one next action, derived from the store's real state.
   *
   * Publishing comes FIRST, and an empty store may be published.
   *
   * An Afrinext store is a commercial identity, not a container that only
   * becomes real once it has stock. A tailor who has claimed her name and her
   * public address can print it on a card and share it while she photographs
   * her work; requiring an offering first would have held her storefront
   * hostage to inventory she has not finished preparing.
   *
   * A published store with nothing in it is not a broken page — it is an
   * honest one, and it says so. What must never happen is the other thing:
   * filling the silence with an invented product. See `listPublicProducts`,
   * which returns exactly what the database holds and nothing else.
   */
  const nextStep: { key: MessageKey; done: boolean } =
    !published ? { key: "dash.stepPublishStore", done: false }
    : products.length === 0 ? { key: "dash.stepAddOffering", done: false }
    : { key: "dash.stepAllDone", done: true };

  return (
    <>
      <AppHeader title={store.name} back={`/${locale}/sell` as Route} />
      <Shell width="wide">
        {/* ---------- Store identity ---------- */}
        <header className="relative">
          <StoreCover brand={store.brand} className="h-24 sm:h-32" />
          <div className="relative z-10 px-4 sm:px-5">
            <div className="-mt-8 flex items-end gap-3">
              <StoreAvatar name={store.name} brand={store.brand} size="lg" ring />
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge tone={published ? "accent" : suspended ? "copper" : "neutral"}>
                  {translate(
                    locale,
                    published ? "dash.statusPublished"
                    : suspended ? "dash.statusSuspended"
                    : "dash.statusDraft",
                  )}
                </Badge>
                <span className="inline-flex items-center gap-1.5 text-caption text-muted">
                  <StoreTypeIcon type={store.storeType} className="h-3.5 w-3.5" />
                  {translate(locale, copy.singular)}
                </span>
              </div>
            </div>

            <h1 className="mt-3 text-h1 text-foreground">{store.name}</h1>
            <p className="mt-1.5 text-small text-muted">
              <span className="font-medium">{translate(locale, "dash.publicUrl")}: </span>
              {published ? (
                <Link href={`/${locale}/s/${store.slug}` as Route} className="font-medium text-copper underline underline-offset-2">
                  /{store.slug}
                </Link>
              ) : (
                <span className="text-muted">{translate(locale, "dash.notPublished")}</span>
              )}
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-6 px-4 py-5 sm:px-5">
          {/* ---------- Suspension notice, before anything else ---------- */}
          {suspended && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-4 py-3.5">
              <p className="text-small font-semibold text-[var(--danger)]">
                {translate(locale, "dash.suspendedTitle")}
              </p>
              <p className="mt-1 text-small text-[var(--danger)]/85">
                {translate(locale, "dash.suspendedBody")}
              </p>
            </div>
          )}

          {/* ---------- What to do next ---------- */}
          {!suspended && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-label uppercase text-copper">
                  {translate(locale, "dash.nextStep")}
                </p>
                <p className="mt-1.5 text-h3 text-foreground">{translate(locale, nextStep.key)}</p>
                {nextStep.done && (
                  <p className="mt-1 text-small text-muted">
                    {translate(locale, "dash.stepAllDoneBody")}
                  </p>
                )}
              </div>
              {/*
                * Rendered for ANY draft, not for a particular next-step
                * message. Tying a control to the guidance text is how the
                * offering requirement became an unwritten rule in the first
                * place: reordering the guidance silently moved the button.
                * The condition is now the store's own status.
                */}
              {!published && (
                <PublishButton
                  locale={locale}
                  storeSlug={store.slug}
                  label={translate(locale, "sell.publishStore")}
                  action={publishStoreAction}
                />
              )}
              {published && (
                <Link href={`/${locale}/s/${store.slug}` as Route} className={buttonClass("outline", "md")}>
                  {translate(locale, "sell.viewPublic")}
                </Link>
              )}
            </Card>
          )}

          {/* ---------- Offerings, named for the trade ---------- */}
          <section className="flex flex-col gap-3" aria-labelledby="offerings-heading">
            <h2 id="offerings-heading" className="text-h2 text-foreground">
              {translate(locale, copy.offerings)}
            </h2>

            {products.length === 0 ? (
              <EmptyState
                icon={<StoreTypeIcon type={store.storeType} className="h-6 w-6" />}
                title={translate(locale, "dash.noOfferings")}
                body={translate(locale, "dash.noOfferingsBody")}
              />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {products.map((product) => (
                  <Card as="li" key={product.id} className="flex flex-col gap-2.5 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-h3 text-foreground">{product.title}</span>
                      <span className="text-h3 font-semibold tabular-nums text-copper">
                        {m.formatMoney(product.price, registry)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={product.status === "published" ? "accent" : "neutral"}>
                        {translate(locale, product.status === "published" ? "sell.published" : "sell.draft")}
                      </Badge>
                      {product.status === "published" ? (
                        <Link
                          href={`/${locale}/s/${store.slug}/${product.slug}` as Route}
                          className="text-small font-semibold text-copper underline underline-offset-2"
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
                    </div>

                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <span className="text-label uppercase text-muted">
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
                            <li key={asset.id} className="text-caption text-muted">
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

                    <ProductDelivery
                      locale={locale}
                      storeSlug={store.slug}
                      productId={product.id}
                      versions={(versionsByProduct.get(product.id) ?? []).map((v) => ({
                        id: v.id, versionNo: v.versionNo, status: v.status,
                        assetCount: v.assetCount,
                      }))}
                      licence={
                        // The DRAFT's licence is the editable one; a published
                        // version's is frozen, so showing it in a text box the
                        // seller can type into would be a lie about what saving
                        // does.
                        (versionsByProduct.get(product.id) ?? [])
                          .find((v) => v.status === "draft")?.licenceText
                        ?? (versionsByProduct.get(product.id) ?? [])
                          .find((v) => v.status === "published")?.licenceText
                        ?? ""
                      }
                      downloadLimit={limitByProduct.get(product.id) ?? null}
                      setLicence={setLicenceAction}
                      setLimit={setDownloadLimitAction}
                      publishVersion={publishVersionAction}
                      labels={{
                        versions: translate(locale, "sell.versions"),
                        draft: translate(locale, "sell.versionDraft"),
                        published: translate(locale, "sell.versionPublished"),
                        publishVersion: translate(locale, "sell.publishVersion"),
                        licence: translate(locale, "sell.licence"),
                        licenceHint: translate(locale, "sell.licenceHint"),
                        saveLicence: translate(locale, "sell.saveLicence"),
                        downloadLimit: translate(locale, "sell.downloadLimit"),
                        downloadLimitHint: translate(locale, "sell.downloadLimitHint"),
                        saveLimit: translate(locale, "sell.saveLimit"),
                        files: translate(locale, "sell.versionFiles", { count: 0 })
                          .replace("0", "{count}"),
                      }}
                    />
                  </Card>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- Add an offering ---------- */}
          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <h2 className="text-lg font-semibold tracking-tight">
              {translate(locale, copy.addOffering)}
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
                submit: translate(locale, copy.addOffering),
              }}
            />
          </section>

          {/* ---------- What is coming, stated honestly ---------- */}
          <section className="flex flex-col gap-3 border-t border-border pt-6" aria-labelledby="soon-heading">
            <h2 id="soon-heading" className="text-label uppercase text-muted">
              {translate(locale, "dash.comingSoon")}
            </h2>
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {(["dash.sectionOrders", "dash.sectionCustomers", "dash.sectionAnalytics", "dash.sectionSettings"] as const).map(
                (key) => (
                  <li
                    key={key}
                    className="rounded-[var(--radius-md)] border border-dashed border-border bg-surface-muted/40 px-3 py-3"
                  >
                    <p className="text-small font-medium text-muted">{translate(locale, key)}</p>
                    {/*
                      * Deliberately no number, not even a zero. A metric card
                      * showing "0 orders" on a store that cannot yet receive
                      * orders is a fabricated metric with an honest value.
                      */}
                    <p className="mt-0.5 text-caption text-faint">
                      {translate(locale, "dash.comingSoon")}
                    </p>
                  </li>
                ),
              )}
            </ul>
          </section>
        </div>
      </Shell>
    </>
  );
}
