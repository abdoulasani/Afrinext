import en from "./messages/en.json";
import fr from "./messages/fr.json";

/**
 * i18n foundation.
 *
 * French is the default locale because the launch market is Niger. Locales are
 * listed here and mirrored in the `locales` table, so adding one is data plus a
 * catalogue rather than a code change.
 *
 * NOT IMPLEMENTED in Phase 0: route-level integration (`/fr/...`, `/en/...`)
 * and the next-intl provider wiring. That lands with the first real screens in
 * Phase 1; adding it now would churn prototype pages that are being replaced.
 */
export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export type MessageKey = keyof typeof fr;

const CATALOGUES: Record<Locale, Record<string, string>> = { fr, en };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(candidate: string | undefined | null): Locale {
  if (candidate === undefined || candidate === null) return DEFAULT_LOCALE;
  const base = candidate.split("-")[0]?.toLowerCase() ?? "";
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/**
 * Looks up a message and substitutes {named} placeholders.
 * A missing key returns the key itself rather than an empty string, so the gap
 * is visible in the interface instead of silently rendering nothing.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const template = CATALOGUES[locale][key] ?? CATALOGUES[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Every catalogue must define the same keys; drift is caught by typecheck. */
export const catalogues = CATALOGUES;
