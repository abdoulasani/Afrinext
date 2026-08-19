import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { authz, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
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
        <AppHeader title={translate(locale, "wallet.available")} />
        <p className="px-4 py-8 text-sm text-muted">
          {translate(locale, "error.permissionDenied")}
        </p>
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

  const section = (title: string, entries: typeof rows.rows, explainer?: string) => (
    <section className="px-4 py-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {entries.length === 0 ? (
        <p className="mt-2 font-mono text-lg">{m.formatMoney(m.money(0n, "XOF"), registry)}</p>
      ) : (
        entries.map((r) => (
          <p key={`${r.kind}-${r.currency}`} className="mt-2 font-mono text-lg">
            {m.formatMoney(m.money(toBig(r.balance_minor), r.currency), registry)}
          </p>
        ))
      )}
      {explainer !== undefined && <p className="mt-1 text-xs text-muted">{explainer}</p>}
    </section>
  );

  return (
    <>
      <AppHeader title={translate(locale, "common.appName")} subtitle={locale.toUpperCase()} />
      {section(translate(locale, "wallet.available"), available)}
      {section(
        translate(locale, "wallet.pending"),
        pending,
        translate(locale, "wallet.pendingExplainer"),
      )}
      <div className="px-4 pb-8 pt-2">
        <Link
          href={`/${locale === "fr" ? "en" : "fr"}/wallet` as Route}
          className="text-xs font-medium text-primary"
        >
          {locale === "fr" ? "English" : "Français"}
        </Link>
      </div>
    </>
  );
}
