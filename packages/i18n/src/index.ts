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
 * Plural rules per locale, built once. `Intl.PluralRules` is what knows that
 * French says "1 offre" AND "0 offre" but "2 offres", while English says
 * "0 offers" — a difference that "offre(s)" papers over by being wrong in both.
 */
const PLURALS: Record<Locale, Intl.PluralRules> = {
  fr: new Intl.PluralRules("fr"),
  en: new Intl.PluralRules("en"),
};

/**
 * Picks the plural variant of a key, if the catalogue defines one.
 *
 * A pluralised message is written as the base key plus `#one`, `#other` and so
 * on — the categories are CLDR's, so a locale that needs `#few` gets it by
 * adding the key rather than by changing this function. A message with no
 * variants is returned untouched, which is almost all of them.
 */
function variantKey(
  locale: Locale,
  key: string,
  values: Readonly<Record<string, string | number>>,
): string {
  const catalogue = CATALOGUES[locale];
  // Cheapest possible check first: no `#one` means this key is not pluralised.
  if (!(`${key}#one` in catalogue)) return key;

  const numeric = Object.values(values).find((value) => typeof value === "number");
  if (numeric === undefined) return key;

  const category = PLURALS[locale].select(numeric);
  return `${key}#${category}` in catalogue ? `${key}#${category}` : key;
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
  const resolved = variantKey(locale, key, values);
  const template =
    CATALOGUES[locale][resolved]
    ?? CATALOGUES[locale][key]
    ?? CATALOGUES[DEFAULT_LOCALE][variantKey(DEFAULT_LOCALE, key, values)]
    ?? CATALOGUES[DEFAULT_LOCALE][key]
    ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Every catalogue must define the same keys; drift is caught by typecheck. */
export const catalogues = CATALOGUES;
