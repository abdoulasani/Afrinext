import { AllocationError } from "./errors";
import { applyRateBps, money, sum, type Money } from "./money";

/**
 * One line of a revenue split.
 *
 * `basis` decides what the rate applies to. The referral programme is the
 * reason this is not always the gross: a referral commission is a share of
 * Afrinext's own realized commission, so it can never exceed what Afrinext
 * earned on the sale. Setting a referral line's basis to the gross would
 * remove that guarantee, which is why the basis is explicit rather than
 * implied.
 *
 * `deductFrom` names a line this one is carved out of. The referral is taken
 * out of the platform commission, not added on top of it.
 */
export interface SplitLine {
  readonly key: string;
  readonly basis: "gross" | { readonly line: string };
  readonly rateBps?: number;
  readonly fixedMinor?: bigint;
  readonly deductFrom?: string;
}

export interface SplitSpec {
  readonly lines: readonly SplitLine[];
  /** Receives everything not taken by a line. Conventionally the seller. */
  readonly residualTo: string;
}

export interface SplitResult {
  readonly gross: Money;
  /** Every line plus the residual, keyed. Always re-sums to gross. */
  readonly amounts: ReadonlyMap<string, Money>;
}

/**
 * Splits a gross amount into named parts.
 *
 * The rounding rule, applied everywhere in Afrinext: every non-residual line
 * is rounded half-up, and the residual is then `gross - sum(other lines)`
 * rather than computed independently. The split therefore re-sums to the gross
 * by construction — no minor unit is created or destroyed by rounding, and the
 * remainder consistently favours the residual holder (the seller).
 */
export function allocate(gross: Money, spec: SplitSpec): SplitResult {
  if (gross.amountMinor < 0n) {
    throw new AllocationError("Cannot split a negative gross amount.");
  }

  const keys = new Set<string>();
  for (const line of spec.lines) {
    if (keys.has(line.key)) throw new AllocationError(`Duplicate split line "${line.key}".`);
    keys.add(line.key);
  }
  if (keys.has(spec.residualTo)) {
    throw new AllocationError(
      `"${spec.residualTo}" is both a line and the residual holder; it must be only one.`,
    );
  }

  // Pass 1 — each line's raw amount, from its declared basis.
  const raw = new Map<string, Money>();
  for (const line of spec.lines) {
    let base: Money;
    if (line.basis === "gross") {
      base = gross;
    } else {
      const referenced = raw.get(line.basis.line);
      if (referenced === undefined) {
        throw new AllocationError(
          `Line "${line.key}" is based on "${line.basis.line}", which is not defined before it.`,
        );
      }
      base = referenced;
    }

    let amount = line.rateBps === undefined ? money(0n, gross.currency) : applyRateBps(base, line.rateBps);
    if (line.fixedMinor !== undefined) {
      amount = money(amount.amountMinor + line.fixedMinor, gross.currency);
    }
    if (amount.amountMinor < 0n) {
      throw new AllocationError(`Line "${line.key}" computed to a negative amount.`);
    }
    raw.set(line.key, amount);
  }

  // Pass 2 — carve deductions out of the lines they are taken from.
  const net = new Map(raw);
  for (const line of spec.lines) {
    if (line.deductFrom === undefined) continue;
    const target = net.get(line.deductFrom);
    if (target === undefined) {
      throw new AllocationError(
        `Line "${line.key}" deducts from "${line.deductFrom}", which is not a line.`,
      );
    }
    const taken = raw.get(line.key);
    /* c8 ignore next */
    if (taken === undefined) throw new AllocationError(`Missing raw amount for "${line.key}".`);
    const remaining = target.amountMinor - taken.amountMinor;
    if (remaining < 0n) {
      throw new AllocationError(
        `Line "${line.key}" takes more than "${line.deductFrom}" holds; a deduction may not exceed its source.`,
      );
    }
    net.set(line.deductFrom, money(remaining, gross.currency));
  }

  // Pass 3 — the residual absorbs the rounding, so the split always balances.
  const lineTotal = sum([...net.values()], gross.currency);
  const residual = gross.amountMinor - lineTotal.amountMinor;
  if (residual < 0n) {
    throw new AllocationError(
      `Split lines total ${lineTotal.amountMinor} which exceeds the gross ${gross.amountMinor}.`,
    );
  }

  const amounts = new Map(net);
  amounts.set(spec.residualTo, money(residual, gross.currency));
  return { gross, amounts: amounts };
}

/** Convenience: read a key, failing loudly rather than returning undefined. */
export function amountOf(result: SplitResult, key: string): Money {
  const value = result.amounts.get(key);
  if (value === undefined) throw new AllocationError(`No split line named "${key}".`);
  return value;
}
