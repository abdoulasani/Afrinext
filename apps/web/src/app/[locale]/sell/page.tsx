import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authz, catalog } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import { CreateStoreForm } from "@/components/CatalogForms";
import { createStoreAction } from "@/lib/catalog-actions";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A seller's stores.
 *
 * `store.create` is checked here only to decide what to render. The Server
 * Action checks it again before doing anything, because a hidden form is not a
 * permission — this page could be fetched, or the action posted directly.
 */
export default async function SellPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const db = getDb();
  const [stores, maySell] = await Promise.all([
    catalog.listOwnStores(db, actor),
    authz.can(db, actor, "store.create"),
  ]);

  return (
    <>
      <AppHeader title={translate(locale, "sell.title")} />
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {translate(locale, "sell.stores")}
          </h2>
          {stores.length === 0 ? (
            <p className="text-sm text-muted">{translate(locale, "sell.noStores")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stores.map((store) => (
                <li key={store.id}>
                  <Link
                    href={`/${locale}/sell/${store.slug}` as Route}
                    className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <span>
                      <span className="block text-sm font-semibold">{store.name}</span>
                      <span className="block text-xs text-muted">/{store.slug}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {translate(
                        locale,
                        store.status === "published"
                          ? "sell.storePublished"
                          : store.status === "suspended"
                            ? "sell.storeSuspended"
                            : "sell.storeDraft",
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {translate(locale, "sell.createStore")}
          </h2>
          {maySell ? (
            <CreateStoreForm
              locale={locale}
              action={createStoreAction}
              labels={{
                name: translate(locale, "sell.storeName"),
                tagline: translate(locale, "sell.storeTagline"),
                submit: translate(locale, "sell.createStore"),
              }}
            />
          ) : (
            <p className="text-sm text-muted">{translate(locale, "sell.notASeller")}</p>
          )}
        </section>
      </div>
    </>
  );
}
