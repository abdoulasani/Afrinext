import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authz, catalog, consent } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import {
  Badge, buttonClass, CheckIcon, EmptyState, StoreAvatar, StoreTypeIcon, TrustNote,
} from "@afrinext/ui";
import ConsentGate from "@/components/ConsentGate";
import { PageIntro } from "@/components/PageIntro";
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
      <PageIntro
        eyebrow={translate(locale, "sell.eyebrow")}
        title={translate(locale, "dash.stores")}
        {...(stores.length > 0
          ? { body: translate(locale, "sell.storeCount", { count: stores.length }) }
          : {})}
        {...(stores.length > 0 && maySell
          ? {
              action: (
                <Link
                  href={`/${locale}/sell/nouvelle` as Route}
                  className={buttonClass("solid", "md")}
                >
                  {translate(locale, "dash.newStore")}
                </Link>
              ),
            }
          : {})}
      />

      <Shell width="wide">
        <div className="flex flex-col gap-8 px-4 pt-6 sm:px-6">
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
                // Document kinds are database values; these are what a person
                // reads. Kept beside the other labels so the gate never has to
                // know the vocabulary itself.
                documentNames: {
                  seller_terms: translate(locale, "consent.sellerTerms"),
                  payout_terms: translate(locale, "consent.payoutTerms"),
                  instructor_terms: translate(locale, "consent.instructorTerms"),
                  referral_terms: translate(locale, "consent.referralTerms"),
                  terms_of_use: translate(locale, "consent.termsOfUse"),
                  privacy_policy: translate(locale, "consent.privacyPolicy"),
                },
              }}
            />
          )}

          {stores.length === 0 ? (
            /*
             * Two different "nothing here" states, and telling them apart
             * matters. Somebody who simply has not opened a store yet gets the
             * invitation AND a plain account of what this area is for — an
             * empty state that only says "nothing here" is a dead end, and the
             * seller area is precisely where a first-time visitor needs to be
             * told what is possible. Somebody whose account does not carry
             * `store.create` is told so instead, rather than being walked into
             * a wizard that would refuse them at the last step.
             */
            <>
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
                          className={buttonClass("accent", "lg")}
                        >
                          {translate(locale, "dash.newStore")}
                        </Link>
                      ),
                    }
                  : {})}
              />

              {maySell && (
                <section
                  aria-labelledby="can-do-heading"
                  className="rounded-[var(--radius-lg)] border border-border bg-surface p-5"
                >
                  <h2 id="can-do-heading" className="text-h3 text-foreground">
                    {translate(locale, "sell.whatYouCanDo")}
                  </h2>
                  <div className="mt-3 flex flex-col gap-2.5">
                    <TrustNote icon={<CheckIcon />}>{translate(locale, "sell.canOpen")}</TrustNote>
                    <TrustNote icon={<CheckIcon />}>{translate(locale, "sell.canPublish")}</TrustNote>
                    <TrustNote icon={<CheckIcon />}>{translate(locale, "sell.canTrack")}</TrustNote>
                  </div>
                </section>
              )}
            </>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stores.map((store) => (
                <li key={store.id}>
                  <Link
                    href={`/${locale}/sell/${store.slug}` as Route}
                    className={
                      "flex items-center gap-3.5 rounded-[var(--radius-lg)] border " +
                      "border-border bg-surface p-4 transition-[border-color,box-shadow,transform] " +
                      "duration-[var(--duration-base)] ease-[var(--ease-out)] " +
                      "hover:-translate-y-[3px] hover:border-border-strong " +
                      "hover:shadow-[var(--shadow-lg)] active:translate-y-0"
                    }
                  >
                    <StoreAvatar name={store.name} brand={store.brand} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-h3 text-foreground">{store.name}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-caption text-muted">
                        <StoreTypeIcon type={store.storeType} className="h-3.5 w-3.5" />
                        {translate(locale, copyFor(store.storeType).singular)}
                      </p>
                      <div className="mt-2.5">
                        {/*
                         * Published is the acacia green, suspended is copper,
                         * draft is quiet. A seller scanning this list should be
                         * able to see which shops are LIVE without reading.
                         */}
                        <Badge
                          tone={
                            store.status === "published" ? "accent"
                            : store.status === "suspended" ? "copper"
                            : "neutral"
                          }
                        >
                          {statusLabel(store.status)}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Shell>
    </>
  );
}
