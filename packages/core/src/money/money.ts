import { CurrencyMismatchError, NegativeAmountError } from "./errors";

/**
 * An amount of money, always paired with its currency.
 *
 * `amountMinor` is an integer count of the currency's minor unit. How many
 * minor units make one major unit is a property of the currency and is read
 * from the currencies table — it is NOT assumed to be 100. XOF and XAF have
 * zero decimal places, so one minor unit is one franc; NGN and GHS have two.
 * Any code that divides by 100 to "get the real amount" is wrong across the
 * whole UEMOA zone.
 */
export interface Money {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export function money(amountMinor: bigint | number, currency: string): Money {
  // Guard before converting: BigInt() throws a RangeError of its own, which
  // hides the actual mistake (a float reaching money) behind a generic message.
  if (typeof amountMinor === "number" && !Number.isSafeInteger(amountMinor)) {
    throw new TypeError(
      `Money must be an integer number of minor units, received ${amountMinor}. ` +
        "Floating point is never used for money.",
    );
  }
  const minor = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  return Object.freeze({ amountMinor: minor, currency });
}

export function zero(currency: string): Money {
  return money(0n, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

export function abs(a: Money): Money {
  return a.amountMinor < 0n ? negate(a) : a;
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0n;
}

export function isNegative(a: Money): boolean {
  return a.amountMinor < 0n;
}

export function isPositive(a: Money): boolean {
  return a.amountMinor > 0n;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/** Sums a list that must be non-empty or accompanied by an explicit currency. */
export function sum(amounts: readonly Money[], currency?: string): Money {
  const first = amounts[0];
  if (first === undefined) {
    if (currency === undefined) {
      throw new TypeError("sum() of an empty list needs an explicit currency.");
    }
    return zero(currency);
  }
  const ccy = currency ?? first.currency;
  let total = 0n;
  for (const a of amounts) {
    if (a.currency !== ccy) throw new CurrencyMismatchError(ccy, a.currency);
    total += a.amountMinor;
  }
  return money(total, ccy);
}

/**
 * Integer multiply-then-divide with half-up rounding, exact at every step.
 *
 * Half-up is applied to the magnitude, so -0.5 rounds to -1 and 0.5 to 1 —
 * symmetric, which keeps a reversal the exact mirror of the entry it reverses.
 */
export function mulDivHalfUp(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero in money arithmetic.");
  const negative = amount < 0n !== numerator < 0n;
  const a = amount < 0n ? -amount : amount;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const product = a * n;
  const quotient = product / d;
  const remainder = product % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Applies a rate in basis points (1800 bps = 18.00%), rounding half-up. */
export function applyRateBps(amount: Money, rateBps: number): Money {
  if (!Number.isInteger(rateBps)) {
    throw new TypeError(`Rate must be integer basis points, received ${rateBps}.`);
  }
  return money(mulDivHalfUp(amount.amountMinor, BigInt(rateBps), 10_000n), amount.currency);
}

export function assertNonNegative(amount: Money, context: string): void {
  if (amount.amountMinor < 0n) throw new NegativeAmountError(context);
}
