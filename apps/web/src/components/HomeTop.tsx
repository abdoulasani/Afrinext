import Link from "next/link";
import type { Route } from "next";
import { sql } from "drizzle-orm";
import { authz, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { translate, type Locale } from "@afrinext/i18n";
import { ServiceGrid, ServiceTile, type ServiceTone } from "@afrinext/ui";
import { ActivityCard } from "./ActivityCard";
import { AppMenuTrigger } from "./HomeHeaderActions";
import { icons } from "./icons";
import { currentActor } from "@/lib/session";

/**
 * The top of the home screen for somebody who is signed in.
 *
 * ---------------------------------------------------------------------------
 * The composition, and where it comes from
 * ---------------------------------------------------------------------------
 *
 * A compact ink header, one card straddling its bottom edge, then a grid of
 * shortcuts. The card overlapping the header is the move that makes the whole
 * screen read as an app rather than a document: it ties the two surfaces
 * together and puts the single most important thing at the optical centre,
 * where a thumb and an eye both already are.
 *
 * Afrinext's version is ink where the reference is a brand colour. That is not
 * timidity — ink is this product's authority colour, and a full-width saturated
 * header is the exact "wall of orange" the palette was rebuilt to remove.
 * Copper stays what it is: a light source in the corner, the price, one action.
 *
 * ---------------------------------------------------------------------------
 * Every number here is counted, and every shortcut goes somewhere
 * ---------------------------------------------------------------------------
 *
 * Balances come from the ledger view the wallet reads. The shortcut set is
 * built from routes that exist — there is no "Profile" tile, because there is
 * no profile screen yet, and a grid where one square in eight does nothing
 * teaches people not to trust the other seven.
 *
 * The seller shortcuts appear only when `authorize()` says `store.create`, and
 * are absent otherwise. This component decides what to RENDER; it never
 * decides what somebody may do.
 */

type Shortcut = { href: string; label: string; icon: keyof typeof icons; tone: ServiceTone };

export async function HomeTop({ locale }: { locale: Locale }) {
  const actor = await currentActor();
  if (actor === undefined) return null;

  const db = getDb();
  const [canSell, canReadWallet] = await Promise.all([
    authz.can(db, actor, "store.create"),
    authz.can(db, actor, "wallet.read_own"),
  ]);

  const shortcuts: Shortcut[] = [
    { href: `/${locale}/explorer`, label: translate(locale, "shortcut.explore"), icon: "explore", tone: "indigo" },
    { href: `/${locale}/explorer?type=formation`, label: translate(locale, "storeType.formation"), icon: "products", tone: "ochre" },
    { href: `/${locale}/library`, label: translate(locale, "shortcut.library"), icon: "library", tone: "forest" },
    { href: `/${locale}/orders`, label: translate(locale, "shortcut.orders"), icon: "orders", tone: "clay" },
  ];
  if (canReadWallet) {
    shortcuts.push({
      href: `/${locale}/wallet`, label: translate(locale, "shortcut.wallet"),
      icon: "wallet", tone: "aubergine",
    });
  }
  shortcuts.push(
    canSell
      ? { href: `/${locale}/sell`, label: translate(locale, "shortcut.myStore"), icon: "myStore", tone: "laterite" }
      : { href: `/${locale}/sell`, label: translate(locale, "nav.sell"), icon: "sales", tone: "laterite" },
  );

  return (
    <>
      <Header locale={locale}>
        {canReadWallet ? <Balances locale={locale} userId={actor.userId} /> : null}
      </Header>

      <section
        aria-labelledby="services-heading"
        className={
          "mx-auto max-w-2xl px-4 sm:px-6 lg:max-w-5xl xl:max-w-6xl " +
          (canReadWallet ? "pt-7" : "pt-6")
        }
      >
        <h2 id="services-heading" className="text-label uppercase text-faint">
          {translate(locale, "home.services")}
        </h2>
        <div className="mt-4">
          <ServiceGrid>
            {shortcuts.map((s) => (
              <Link
                key={s.href}
                href={s.href as Route}
                className="rounded-[var(--radius-md)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
              >
                <ServiceTile label={s.label} tone={s.tone} icon={icons[s.icon]} />
              </Link>
            ))}
          </ServiceGrid>
        </div>
      </section>
    </>
  );
}

/**
 * The ink strip, and the card that hangs off its bottom edge.
 *
 * The extra bottom padding plus the card's negative margin is what produces the
 * overlap. Doing it with padding rather than absolute positioning means the
 * card can be any height — one balance row or two — without the header needing
 * to know.
 */
function Header({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <>
      <header
        className="relative isolate overflow-hidden bg-ink text-[var(--on-ink)]"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 70% 70% at 90% -20%, var(--copper), transparent 60%)",
          }}
        />
        <div
          className={
            "relative mx-auto flex max-w-2xl items-start justify-between gap-4 px-5 " +
            "pb-14 pt-4 sm:px-6 lg:max-w-5xl xl:max-w-6xl"
          }
        >
          <div className="min-w-0">
            <p className="text-caption text-[var(--on-ink-muted)]">
              {translate(locale, "home.welcomeTo")}
            </p>
            <h1 className="mt-0.5 flex items-baseline gap-[3px] text-h1 tracking-[-0.03em] text-[var(--on-ink)]">
              Afrinext
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-copper-on-ink" />
            </h1>
          </div>
          <AppMenuTrigger
            locale={locale}
            label={translate(locale, "menu.language")}
          />
        </div>
      </header>

      {children !== null && (
        <div className="mx-auto -mt-10 max-w-2xl px-4 sm:px-6 lg:max-w-5xl xl:max-w-6xl">
          {children}
        </div>
      )}
    </>
  );
}

/** The ledger, read the same way the wallet reads it. */
async function Balances({ locale, userId }: { locale: Locale; userId: string }) {
  const db = getDb();
  const [currencyRows, rows] = await Promise.all([
    db.execute<{ code: string; minor_unit: number }>(
      sql`select code, minor_unit from currencies`,
    ),
    db.execute<{ kind: string; currency: string; balance_minor: bigint | string }>(sql`
      select kind, currency, balance_minor
        from ledger_account_balances_derived
       where owner_type = 'user' and owner_id = ${userId}::uuid
       order by currency, kind
    `),
  ]);

  const registry = m.createCurrencyRegistry(
    currencyRows.rows.map((r) => ({ code: r.code, minorUnit: Number(r.minor_unit) })),
  );
  const toBig = (v: bigint | string): bigint => (typeof v === "bigint" ? v : BigInt(v));

  /*
   * One line per kind, and XOF when there is nothing.
   *
   * A person with no ledger rows has no currency either, so the zero has to be
   * denominated in something: the launch currency, read from the registry
   * rather than formatted by hand — XOF has zero decimals and dividing by 100
   * is wrong across the whole UEMOA zone.
   */
  const sum = (kind: string): string => {
    const entries = rows.rows.filter((r) => r.kind === kind);
    if (entries.length === 0) return m.formatMoney(m.money(0n, "XOF"), registry);
    return entries
      .map((r) => m.formatMoney(m.money(toBig(r.balance_minor), r.currency), registry))
      .join(" · ");
  };

  return (
    <ActivityCard
      eyebrow={translate(locale, "home.activityCard")}
      availableLabel={translate(locale, "wallet.available")}
      available={sum("user_available")}
      pendingLabel={translate(locale, "wallet.pending")}
      pending={sum("user_pending")}
      walletHref={`/${locale}/wallet`}
      walletLabel={translate(locale, "home.toWallet")}
      showLabel={translate(locale, "home.showAmounts")}
      hideLabel={translate(locale, "home.hideAmounts")}
      hiddenLabel={translate(locale, "home.amountsHidden")}
    />
  );
}
