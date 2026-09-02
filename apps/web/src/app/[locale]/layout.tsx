import { notFound } from "next/navigation";
import { auth as core, authz } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate, type Locale } from "@afrinext/i18n";
import type { ReactNode } from "react";
import BottomNav from "@/components/BottomNav";
import { AppMenu, type MenuSection } from "@/components/AppMenu";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { SignOutButton } from "@/components/SignOutButton";
import { sessionIdentity } from "@/lib/email-auth";
import { currentActor } from "@/lib/session";

/**
 * Locale-scoped routes: /fr/... and /en/....
 *
 * French is the default because the launch market is Niger. The locale is
 * validated here and nowhere else — a dynamic segment at the root would
 * otherwise swallow every unmatched path and render it as a language.
 *
 * The navigation lives here rather than at the root because its labels are
 * words, and words have a language.
 *
 * ---------------------------------------------------------------------------
 * Four destinations and a drawer
 * ---------------------------------------------------------------------------
 *
 * The bar used to carry five destinations, one of which was Orders — a screen
 * people visit when something is wrong, given the same permanent weight as the
 * marketplace itself. Four real places plus a Menu reads faster, and it gives
 * the screens that do not deserve a tab (orders, wallet, profile) somewhere to
 * live that is not a shortcut grid on the home screen.
 *
 * `Vendre` stays in the bar for everybody, deliberately. It is the invitation
 * this marketplace is built on, and hiding it from people who have not yet
 * opened a store would hide the one thing they might come back for. It is not
 * a permission: `/sell` itself asks `authorize()` and tells an actor without
 * `store.create` exactly that, which is a better answer than a missing tab.
 */
export function generateStaticParams(): { locale: Locale }[] {
  return [{ locale: "fr" }, { locale: "en" }];
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const tabs = [
    {
      href: `/${locale}`,
      match: "/",
      label: translate(locale, "nav.home"),
      icon: "M3 10.5 12 3l9 7.5M5 9.75V21h14V9.75",
    },
    {
      href: `/${locale}/explorer`,
      match: "/explorer",
      label: translate(locale, "nav.explore"),
      icon: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM21 21l-5.2-5.2",
    },
    {
      href: `/${locale}/sell`,
      match: "/sell",
      label: translate(locale, "nav.sell"),
      icon: "M4 7.5h16M6 7.5V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1.5M5 7.5 6 20h12l1-12.5",
    },
    {
      href: `/${locale}/library`,
      match: "/library",
      label: translate(locale, "nav.library"),
      // A stack of pages, open at the top: what you own, not what you ordered.
      icon: "M4 6.5A1.5 1.5 0 0 1 5.5 5H10a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 14.5ZM20 6.5A1.5 1.5 0 0 0 18.5 5H14a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5Z",
    },
  ];

  /*
   * What the drawer offers is decided HERE, by asking the same authorize()
   * every route handler asks. A section absent below is absent because the
   * permission check said so — the client component renders what it is given
   * and has no flag that could put it back.
   */
  const actor = await currentActor();
  const canSell = actor === undefined
    ? false
    : await authz.can(getDb(), actor, "store.create");

  const sections: MenuSection[] = [
    {
      title: translate(locale, "menu.marketplace"),
      links: [
        { href: `/${locale}/explorer`, label: translate(locale, "shortcut.explore"), icon: "explore" },
        { href: `/${locale}/library`, label: translate(locale, "shortcut.library"), icon: "library" },
        { href: `/${locale}/orders`, label: translate(locale, "shortcut.orders"), icon: "orders" },
      ],
    },
  ];

  if (canSell) {
    sections.push({
      title: translate(locale, "menu.selling"),
      links: [
        { href: `/${locale}/sell`, label: translate(locale, "shortcut.myStore"), icon: "myStore" },
      ],
    });
  }

  if (actor !== undefined) {
    sections.push({
      title: translate(locale, "menu.account"),
      links: [
        { href: `/${locale}/wallet`, label: translate(locale, "shortcut.wallet"), icon: "wallet" },
        // Changing programme is an UPDATE on the account somebody already has.
        // Reachable from the drawer so nobody ever concludes they need a second.
        { href: `/${locale}/programme`, label: translate(locale, "programme.change"), icon: "profile" },
      ],
    });
  }

  // The other language, as a link to the same page in it. Offered to everyone,
  // signed in or not — language is not a privilege.
  const other: Locale = locale === "fr" ? "en" : "fr";
  const footer = [
    { href: `/${other}`, label: other === "fr" ? "Français" : "English", icon: "globe" as const },
    ...(actor === undefined
      ? [{ href: `/${locale}/sign-in`, label: translate(locale, "home.signIn"), icon: "profile" as const }]
      : []),
  ];

  /*
   * The unverified banner.
   *
   * Read here so it appears on every signed-in screen rather than being
   * remembered by each one. It is shown only for an account that HAS a
   * reachable address and has not confirmed it: a phone account's synthetic
   * `@phone.afrinext.local` address can receive nothing, so nagging its owner
   * to verify it would be asking for something impossible.
   *
   * It gates nothing. `users.status` is the consent gate and is untouched by
   * verification; every screen behind this banner is reachable with it showing.
   */
  const identity = actor === undefined ? undefined : await sessionIdentity();
  const showVerifyBanner =
    identity !== undefined
    && !identity.emailVerified
    && core.isReachableEmail(identity.email);

  return (
    <div lang={locale} className="min-h-full">
      {showVerifyBanner && identity !== undefined && (
        <EmailVerificationBanner
          email={identity.email}
          message={translate(locale, "auth.verifyBanner", { email: "{email}" })}
          action={translate(locale, "auth.verifyBannerAction")}
          dismiss={translate(locale, "auth.verifyLater")}
          href={`/${locale}/verify-email`}
        />
      )}
      {/*
        * `lg:pt-16` makes room for the navigation, which is a fixed h-16 bar at
        * the TOP from `lg` up and a fixed tab bar at the bottom below that. The
        * space is made once, here, rather than by every page — a page that
        * forgot would render its first heading underneath the bar.
        */}
      <div className="lg:pt-16">{children}</div>
      <BottomNav
        tabs={tabs}
        menu={
          <AppMenu
            label={translate(locale, "nav.menu")}
            title={translate(locale, "menu.title")}
            sections={sections}
            footer={footer}
            footerAction={
              actor === undefined
                ? undefined
                : <SignOutButton locale={locale} label={translate(locale, "menu.signOut")} />
            }
            closeLabel={translate(locale, "home.closeMenu")}
          />
        }
      />
    </div>
  );
}
