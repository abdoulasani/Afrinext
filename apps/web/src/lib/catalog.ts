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
