import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authz, catalog, consent } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { Badge, buttonClass, Card, EmptyState, StoreAvatar, StoreTypeIcon } from "@afrinext/ui";
import AppHeader from "@/components/AppHeader";
import ConsentGate from "@/components/ConsentGate";
import { Shell } from "@/components/Shell";
import { acceptSellerTermsAction } from "@/lib/consent-actions";
import { actorLegalContext } from "@/lib/consent";
import { currentActor } from "@/lib/session";
import { copyFor } from "@/lib/store-presentation";

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

  const outstanding = maySell
    ? await consent.outstandingConsents(
        db, actor.userId, catalog.SELLER_CONSENT_KINDS, await actorLegalContext(db, actor),
      )
    : [];

  const statusLabel = (status: string): string =>
    translate(
      locale,
      status === "published" ? "dash.statusPublished"
      : status === "suspended" ? "dash.statusSuspended"
      : "dash.statusDraft",
    );

  return (
    <>
      <AppHeader title={translate(locale, "dash.stores")} />
      <Shell width="wide">
        <div className="flex flex-col gap-6 px-4 py-5 sm:px-5">
          {/* The seller terms gate. Presentation only; createStore re-checks. */}
          {maySell && outstanding.length > 0 && (
            <ConsentGate
              locale={locale}
              documents={outstanding.map((doc) => ({
                kind: doc.kind, version: doc.version, locale: doc.locale, contentHash: doc.contentHash,
              }))}
              action={acceptSellerTermsAction}
              labels={{
                heading: translate(locale, "consent.heading"),
                explain: translate(locale, "consent.explain"),
                version: translate(locale, "consent.version"),
                placeholder: translate(locale, "consent.placeholder"),
                accept: translate(locale, "consent.accept"),
              }}
            />
          )}

          {stores.length === 0 ? (
            /*
             * Two different "nothing here" states, and telling them apart
             * matters. Somebody who simply has not opened a store yet gets the
             * invitation; somebody whose account does not carry `store.create`
             * gets told so, rather than being walked into a wizard that would
             * refuse them at the last step.
             */
            <EmptyState
              icon={<StoreTypeIcon type="service" className="h-6 w-6" />}
              title={
                maySell
                  ? translate(locale, "dash.noStoresTitle")
                  : translate(locale, "dash.notASellerTitle")
              }
              body={
                maySell
                  ? translate(locale, "dash.noStoresBody")
                  : translate(locale, "sell.notASeller")
              }
              {...(maySell
                ? {
                    action: (
                      <Link
                        href={`/${locale}/sell/nouvelle` as Route}
                        className={buttonClass("primary", "lg")}
                      >
                        {translate(locale, "dash.newStore")}
                      </Link>
                    ),
                  }
                : {})}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight">
                  {translate(locale, "dash.stores")}
                </h2>
                {maySell && (
                  <Link href={`/${locale}/sell/nouvelle` as Route} className={buttonClass("secondary", "sm")}>
                    + {translate(locale, "dash.newStore")}
                  </Link>
                )}
              </div>

              <ul className="grid gap-3 sm:grid-cols-2">
                {stores.map((store) => (
                  <Card as="li" key={store.id} interactive>
                    <Link href={`/${locale}/sell/${store.slug}` as Route} className="flex gap-3 p-4">
                      <StoreAvatar name={store.name} brand={store.brand} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{store.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                          <StoreTypeIcon type={store.storeType} className="h-3.5 w-3.5" />
                          {translate(locale, copyFor(store.storeType).singular)}
                        </p>
                        <div className="mt-2">
                          <Badge tone={store.status === "published" ? "accent" : "neutral"}>
                            {statusLabel(store.status)}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  </Card>
                ))}
              </ul>
            </>
          )}
        </div>
      </Shell>
    </>
  );
}
