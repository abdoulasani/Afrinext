import { sql } from "drizzle-orm";
import { money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";

/**
 * Shared helpers for the catalogue's transport layer.
 *
 * Everything that decides anything lives in `packages/core/catalog`. What is
 * here is rendering and serialisation — the two things that genuinely differ
 * between a page and an API route.
 */

/** The exponent comes from the table, never from a constant. */
export async function currencyRegistry(): Promise<m.CurrencyRegistry> {
  const rows = await getDb().execute<{ code: string; minor_unit: number }>(
    sql`select code, minor_unit from currencies where is_active = true`,
  );
  return m.createCurrencyRegistry(
    rows.rows.map((r) => ({ code: r.code, minorUnit: Number(r.minor_unit) })),
  );
}

/**
 * Money on the wire.
 *
 * `JSON.stringify` throws on a bigint, which is a useful accident: it forces
 * every transport to say how an amount is represented instead of letting one
 * quietly become a float. Minor units go out as a string, with the currency and
 * its exponent alongside, so a client never has to guess where the decimal
 * point belongs.
 */
export function serialiseMoney(
  amount: m.Money,
  registry: m.CurrencyRegistry,
): { amountMinor: string; currency: string; minorUnit: number; formatted: string } {
  return {
    amountMinor: amount.amountMinor.toString(),
    currency: amount.currency,
    minorUnit: registry.require(amount.currency).minorUnit,
    formatted: m.formatMoney(amount, registry),
  };
}

/**
 * Country codes to display names, in the reader's language.
 *
 * The `countries` table stores one canonical name; `Intl.DisplayNames` turns
 * the code into "Niger" or "Nigéria" for the locale being rendered. Falling
 * back to the stored name keeps a country visible even if the runtime has no
 * data for it, and falling back to the code keeps it visible even then.
 */
export async function countryNames(
  locale: string = "fr",
): Promise<Readonly<Record<string, string>>> {
  const rows = await getDb().execute<{ [k: string]: unknown; code: string; name: string }>(
    sql`select code, name from countries`,
  );
  let display: Intl.DisplayNames | undefined;
  try {
    display = new Intl.DisplayNames([locale === "en" ? "en" : "fr"], { type: "region" });
  } catch {
    display = undefined;
  }
  const names: Record<string, string> = {};
  for (const row of rows.rows) {
    names[row.code] = display?.of(row.code) ?? row.name;
  }
  return names;
}

/**
 * The countries a seller may choose, in the reader's language.
 *
 * Only markets Afrinext has actually launched in: a store in a country with
 * no currency row, no payment channel and no support is a store that cannot
 * take money.
 */
export async function supportedCountries(
  locale: string = "fr",
): Promise<readonly { code: string; name: string }[]> {
  const [rows, names] = await Promise.all([
    getDb().execute<{ [k: string]: unknown; code: string }>(
      sql`select code from countries where is_supported = true order by code`,
    ),
    countryNames(locale),
  ]);
  return rows.rows.map((row) => ({ code: row.code, name: names[row.code] ?? row.code }));
}
