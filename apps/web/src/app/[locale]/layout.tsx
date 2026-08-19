import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@afrinext/i18n";
import type { ReactNode } from "react";

/**
 * Locale-scoped routes: /fr/... and /en/....
 *
 * French is the default because the launch market is Niger. The locale is
 * validated here and nowhere else — a dynamic segment at the root would
 * otherwise swallow every unmatched path and render it as a language.
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
  return <div lang={locale}>{children}</div>;
}
