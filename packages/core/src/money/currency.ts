import { UnknownCurrencyError } from "./errors";
import { money, type Money } from "./money";

/**
 * Currencies are data, loaded from the currencies table — never constants.
 * `minorUnit` is the ISO 4217 exponent: 0 for XOF and XAF, 2 for NGN and GHS.
 */
export interface CurrencyInfo {
  readonly code: string;
  readonly minorUnit: number;
}

export interface CurrencyRegistry {
  get(code: string): CurrencyInfo | undefined;
  require(code: string): CurrencyInfo;
  list(): readonly CurrencyInfo[];
}

export function createCurrencyRegistry(currencies: readonly CurrencyInfo[]): CurrencyRegistry {
  const byCode = new Map<string, CurrencyInfo>();
  for (const c of currencies) {
    if (!Number.isInteger(c.minorUnit) || c.minorUnit < 0 || c.minorUnit > 4) {
      throw new RangeError(`Currency ${c.code} has an implausible minor unit ${c.minorUnit}.`);
    }
    byCode.set(c.code, Object.freeze({ ...c }));
  }
  return {
    get: (code) => byCode.get(code),
    require(code) {
      const found = byCode.get(code);
      if (found === undefined) throw new UnknownCurrencyError(code);
      return found;
    },
    list: () => [...byCode.values()],
  };
}

function pow10(exponent: number): bigint {
  let result = 1n;
  for (let i = 0; i < exponent; i += 1) result *= 10n;
  return result;
}

/**
 * Renders an amount for display. Grouping uses a narrow no-break space, which
 * is the convention in the francophone markets Afrinext launches into.
 */
export function formatMoney(
  amount: Money,
  registry: CurrencyRegistry,
  options: { readonly withCode?: boolean } = {},
): string {
  const info = registry.require(amount.currency);
  const negative = amount.amountMinor < 0n;
  const magnitude = negative ? -amount.amountMinor : amount.amountMinor;
  const divisor = pow10(info.minorUnit);

  const whole = (magnitude / divisor).toString();
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction =
    info.minorUnit === 0 ? "" : `.${(magnitude % divisor).toString().padStart(info.minorUnit, "0")}`;

  const body = `${negative ? "-" : ""}${grouped}${fraction}`;
  return options.withCode === false ? body : `${body} ${amount.currency}`;
}

/**
 * Parses a decimal string into minor units for the given currency.
 * Rejects anything with more decimal places than the currency has, rather than
 * silently rounding a user's input.
 */
export function parseMoney(input: string, currency: string, registry: CurrencyRegistry): Money {
  const info = registry.require(currency);
  // Accept the grouping separators formatMoney emits, including the narrow
  // no-break space (U+202F), so format and parse round-trip.
  const cleaned = input.replace(/[\s\u00A0\u202F]/g, "");
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(cleaned);
  if (match === null) throw new TypeError(`"${input}" is not a valid amount.`);

  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length > info.minorUnit) {
    throw new TypeError(
      `${currency} has ${info.minorUnit} decimal place(s); "${input}" has ${fraction.length}.`,
    );
  }
  const padded = fraction.padEnd(info.minorUnit, "0");
  const minor = BigInt(whole) * pow10(info.minorUnit) + BigInt(padded === "" ? "0" : padded);
  return money(sign === "-" ? -minor : minor, currency);
}

/** The launch set. Loaded into the currencies table by the seed, not hard-coded in logic. */
export const ISO_MINOR_UNITS: Readonly<Record<string, number>> = Object.freeze({
  XOF: 0,
  XAF: 0,
  NGN: 2,
  GHS: 2,
  USD: 2,
  EUR: 2,
});
