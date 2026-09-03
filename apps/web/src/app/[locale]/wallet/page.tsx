import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { authz, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { EmptyState, PriceTag, SectionHeader } from "@afrinext/ui";
import AppHeader from "@/components/AppHeader";
import { PageIntro } from "@/components/PageIntro";
import { Shell } from "@/components/Shell";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's entitlements.
 *
 * A real screen behind real authentication and real authorization: the session
 * resolves to an Afrinext actor, `wallet.read_own` is checked server-side, and
 * the balances are read from the ledger entries rather than the cache.
 *
 * The wording is deliberate. These are contractual entitlements against
 * Afrinext, not deposits and not protected client funds — the architecture's
 * regulatory posture is a property of the interface too, not just the schema.
 */
export default async function WalletPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  // typedRoutes cannot expand a computed dynamic segment, so the cast is
  // explicit rather than the whole check being switched off.
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const db = getDb();
  if (!(await authz.can(db, actor, "wallet.read_own"))) {
    return (
      <>
        <AppHeader title={translate(locale, "wallet.title")} />
        <Shell width="narrow">
          <div className="px-4 pt-8 sm:px-6">
            <EmptyState title={translate(locale, "error.permissionDenied")} />
          </div>
        </Shell>
      </>
    );
  }

  const currencyRows = await db.execute<{ code: string; minor_unit: number }>(
    sql`select code, minor_unit from currencies`,
  );
  const registry = m.createCurrencyRegistry(
    currencyRows.rows.map((r) => ({ code: r.code, minorUnit: Number(r.minor_unit) })),
  );

  const rows = await db.execute<{ kind: string; currency: string; balance_minor: bigint | string }>(sql`
    select kind, currency, balance_minor
      from ledger_account_balances_derived
     where owner_type = 'user' and owner_id = ${actor.userId}::uuid
     order by currency, kind
  `);

  const toBig = (v: bigint | string): bigint => (typeof v === "bigint" ? v : BigInt(v));
  const available = rows.rows.filter((r) => r.kind === "user_available");
  const pending = rows.rows.filter((r) => r.kind === "user_pending");

  /*
   * A balance, set as money rather than as monospaced debug output.
   *
   * The previous version printed these in `font-mono`, which is the typeface of
   * a log file: it says "this is a value the system emitted", not "this is what
   * you have". `PriceTag` is the same component the marketplace uses for a
   * price, so an amount looks like an amount everywhere in Afrinext — and it is
   * tabular, so two currencies line up.
   *
   * Zero is printed, never hidden. An empty balance is a fact, and a wallet
   * that shows nothing at all reads as broken.
   */
  const section = (
    title: string, entries: typeof rows.rows, explainer?: string,
  ) => (
    <section className="mt-8 first:mt-0">
      <SectionHeader title={title} {...(explainer !== undefined ? { body: explainer } : {})} />
      <div className="mt-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        {entries.length === 0 ? (
          <PriceTag
            amount={m.formatMoney(m.money(0n, "XOF"), registry)}
            size="xl"
            tone="foreground"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((r) => (
              <PriceTag
                key={`${r.kind}-${r.currency}`}
                amount={m.formatMoney(m.money(toBig(r.balance_minor), r.currency), registry)}
                size="xl"
                tone="foreground"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <>
      <PageIntro
        eyebrow={translate(locale, "wallet.eyebrow")}
        title={translate(locale, "wallet.title")}
      />
      <Shell width="narrow">
        <div className="px-4 pt-6 sm:px-6">
          {section(translate(locale, "wallet.available"), available)}
          {section(
            translate(locale, "wallet.pending"),
            pending,
            translate(locale, "wallet.pendingExplainer"),
          )}

          {/*
           * The regulatory posture, on the screen rather than only in a
           * document. These are contractual entitlements against Afrinext, not
           * deposits and not protected client funds, and no screen here is
           * allowed to imply otherwise.
           */}
          <p className="mt-8 border-t border-border pt-5 text-caption text-faint">
            {translate(locale, "wallet.entitlementNote")}
          </p>
        </div>
      </Shell>
    </>
  );
}
