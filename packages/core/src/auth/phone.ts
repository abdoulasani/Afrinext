/**
 * Phone numbers are stored in E.164 and never in a local format: the same
 * subscriber must not be able to hold two accounts by writing their number two
 * ways. Country calling codes come from the countries table rather than a
 * constant, so adding a market does not require a code change.
 */
export interface CallingCodeSource {
  readonly countryCode: string;
  readonly callingCode: string;
}

export type PhoneParseResult =
  | { readonly ok: true; readonly e164: string; readonly countryCode: string | null }
  | { readonly ok: false; readonly reason: string };

export function normalisePhone(
  input: string,
  countries: readonly CallingCodeSource[],
  defaultCountry?: string,
): PhoneParseResult {
  // Strip separators people actually type, including the narrow no-break
  // space (U+202F) used to group digits in francophone formatting.
  const trimmed = input.replace(/[\s\-().\u00A0\u202F]/g, "");
  if (trimmed === "") return { ok: false, reason: "empty" };

  if (trimmed.startsWith("+")) {
    if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) return { ok: false, reason: "not_e164" };
    // Longest calling code wins: +22 must not shadow +227.
    const match = [...countries]
      .sort((a, b) => b.callingCode.length - a.callingCode.length)
      .find((c) => trimmed.startsWith(c.callingCode));
    return { ok: true, e164: trimmed, countryCode: match?.countryCode ?? null };
  }

  if (defaultCountry === undefined) return { ok: false, reason: "no_country_context" };
  const country = countries.find((c) => c.countryCode === defaultCountry);
  if (country === undefined) return { ok: false, reason: "unknown_country" };

  const national = trimmed.replace(/^0+/, "");
  const e164 = `${country.callingCode}${national}`;
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) return { ok: false, reason: "not_e164" };
  return { ok: true, e164, countryCode: country.countryCode };
}

export function normaliseEmail(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}
