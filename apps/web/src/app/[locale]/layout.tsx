import { notFound } from "next/navigation";
import { isLocale, translate, type Locale } from "@afrinext/i18n";
import type { ReactNode } from "react";
import BottomNav from "@/components/BottomNav";

/**
 * Locale-scoped routes: /fr/... and /en/....
 *
 * French is the default because the launch market is Niger. The locale is
 * validated here and nowhere else — a dynamic segment at the root would
 * otherwise swallow every unmatched path and render it as a language.
 *
 * The navigation lives here rather than at the root because its labels are
 * words, and words have a language.
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
      href: `/${locale}/orders`,
      match: "/orders",
      label: translate(locale, "nav.orders"),
      icon: "M9 5h6m-8 3.5h10l-1 11H8l-1-11ZM9.5 12v4M14.5 12v4",
    },
  ];

  return (
    <div lang={locale} className="min-h-full">
      {children}
      <BottomNav tabs={tabs} />
    </div>
  );
}
