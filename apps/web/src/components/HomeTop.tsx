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

  /*
   * Each tile takes the colour whose JOB it is, not the one that looks nice
   * next to its neighbour. Discovery is gold, content is green, the library is
   * violet, records are clay, money is indigo, and selling — the brand act —
   * is the brand orange. Somebody who uses this twice reaches for the green
   * square without reading the word under it, which is the whole point of
   * giving each shortcut a permanent identity.
   */
  const shortcuts: Shortcut[] = [
    { href: `/${locale}/explorer`, label: translate(locale, "shortcut.explore"), icon: "explore", tone: "ochre" },
    { href: `/${locale}/explorer?type=formation`, label: translate(locale, "storeType.formation"), icon: "products", tone: "forest" },
    { href: `/${locale}/library`, label: translate(locale, "shortcut.library"), icon: "library", tone: "aubergine" },
    { href: `/${locale}/orders`, label: translate(locale, "shortcut.orders"), icon: "orders", tone: "clay" },
  ];
  if (canReadWallet) {
    shortcuts.push({
      href: `/${locale}/wallet`, label: translate(locale, "shortcut.wallet"),
      icon: "wallet", tone: "indigo",
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
        <h2 id="services-heading" className="text-label uppercase text-muted">
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
        className="relative isolate overflow-hidden text-[var(--on-brand)]"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          /*
           * Sunset, and it runs DARKER downward, not lighter.
           *
           * The caption and the wordmark sit in the top-left, over the lightest
           * point — so that point is the one that had to clear 4.5:1 against
           * white, and it does at 4.75:1. A gradient that brightened toward the
           * bottom would have put small white text over an orange too pale to
           * read, which is the usual way a warm header fails an audit.
           */
          backgroundImage:
            "linear-gradient(168deg, var(--copper) 0%, #b33e14 58%, #92300f 100%)",
        }}
      >
        {/* The low sun, off the top-right corner. Behind the language chip,
            which carries its own surface, so it never sits under small text. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.6]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 95% at 90% -5%, #f8c46b, transparent 64%)",
          }}
        />
        <div
          className={
            /*
             * Deep enough that the gradient is a sunset rather than a stripe.
             * The first pass gave it pb-14 and the warm-to-deep ramp had barely
             * 90px to travel, so it read as flat orange — the colour was there
             * and the light was not.
             */
            "relative mx-auto flex max-w-2xl items-start justify-between gap-4 px-5 " +
            "pb-24 pt-6 sm:px-6 lg:max-w-5xl xl:max-w-6xl lg:pb-28"
          }
        >
          <div className="min-w-0">
            <p className="text-caption text-[var(--on-brand-muted)]">
              {translate(locale, "home.welcomeTo")}
            </p>
            <h1 className="mt-0.5 flex items-baseline gap-[3px] text-h1 tracking-[-0.03em] text-white">
              Afrinext
              {/* The dot was copper on ink. On a sunset band copper is
                  invisible, so it becomes the sand it always contrasted with. */}
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#f6d9a8]" />
            </h1>
          </div>
          <AppMenuTrigger
            locale={locale}
            label={translate(locale, "menu.language")}
          />
        </div>
      </header>

      {children !== null && (
        <div className="mx-auto -mt-16 max-w-2xl px-4 sm:px-6 lg:max-w-5xl xl:max-w-6xl">
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
