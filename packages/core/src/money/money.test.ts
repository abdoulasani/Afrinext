import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  add, applyRateBps, compare, CurrencyMismatchError, equals, money,
  mulDivHalfUp, negate, subtract, sum, zero,
} from "./index";

describe("Money arithmetic", () => {
  it("refuses to combine different currencies", () => {
    expect(() => add(money(100n, "XOF"), money(100n, "NGN"))).toThrow(CurrencyMismatchError);
    expect(() => subtract(money(100n, "XOF"), money(100n, "NGN"))).toThrow(CurrencyMismatchError);
    expect(() => compare(money(100n, "XOF"), money(100n, "NGN"))).toThrow(CurrencyMismatchError);
  });

  it("refuses a non-integer amount", () => {
    expect(() => money(10.5, "XOF")).toThrow(TypeError);
  });

  it("sums an empty list only with an explicit currency", () => {
    expect(() => sum([])).toThrow(TypeError);
    expect(equals(sum([], "XOF"), zero("XOF"))).toBe(true);
  });

  describe("properties", () => {
    const amount = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });

    it("addition is associative and commutative", () => {
      fc.assert(
        fc.property(amount, amount, amount, (a, b, c) => {
          const [x, y, z] = [money(a, "XOF"), money(b, "XOF"), money(c, "XOF")];
          expect(equals(add(add(x, y), z), add(x, add(y, z)))).toBe(true);
          expect(equals(add(x, y), add(y, x))).toBe(true);
        }),
        { numRuns: 500 },
      );
    });

    it("subtracting then adding restores the original", () => {
      fc.assert(
        fc.property(amount, amount, (a, b) => {
          const [x, y] = [money(a, "XOF"), money(b, "XOF")];
          expect(equals(add(subtract(x, y), y), x)).toBe(true);
        }),
        { numRuns: 500 },
      );
    });

    it("negation is its own inverse and sums to zero", () => {
      fc.assert(
        fc.property(amount, (a) => {
          const x = money(a, "XOF");
          expect(equals(negate(negate(x)), x)).toBe(true);
          expect(equals(add(x, negate(x)), zero("XOF"))).toBe(true);
        }),
        { numRuns: 500 },
      );
    });

    it("sum equals a fold of add", () => {
      fc.assert(
        fc.property(fc.array(amount, { maxLength: 40 }), (values) => {
          const items = values.map((v) => money(v, "XOF"));
          const folded = items.reduce((acc, m) => add(acc, m), zero("XOF"));
          expect(equals(sum(items, "XOF"), folded)).toBe(true);
        }),
        { numRuns: 300 },
      );
    });
  });
});

describe("mulDivHalfUp", () => {
  it("rounds half away from zero, symmetrically", () => {
    expect(mulDivHalfUp(5n, 1n, 2n)).toBe(3n); // 2.5 -> 3
    expect(mulDivHalfUp(-5n, 1n, 2n)).toBe(-3n); // -2.5 -> -3
    expect(mulDivHalfUp(4n, 1n, 2n)).toBe(2n);
    expect(mulDivHalfUp(1n, 1n, 3n)).toBe(0n);
    expect(mulDivHalfUp(2n, 1n, 3n)).toBe(1n);
  });

  it("rejects division by zero", () => {
    expect(() => mulDivHalfUp(1n, 1n, 0n)).toThrow(RangeError);
  });

  it("never deviates from the exact quotient by more than half a unit", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10_000n }),
        (amount, rate) => {
          const result = mulDivHalfUp(amount, rate, 10_000n);
          // |result * 10000 - amount * rate| <= 5000  (half of the denominator)
          const error = result * 10_000n - amount * rate;
          const magnitude = error < 0n ? -error : error;
          expect(magnitude <= 5_000n).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("is exactly reversible in sign", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (a) => {
        expect(mulDivHalfUp(-a, 3n, 7n)).toBe(-mulDivHalfUp(a, 3n, 7n));
      }),
      { numRuns: 500 },
    );
  });
});

describe("applyRateBps", () => {
  it("computes the documented 18% example exactly", () => {
    expect(applyRateBps(money(10_000n, "XOF"), 1800).amountMinor).toBe(1800n);
  });

  it("rejects fractional basis points", () => {
    expect(() => applyRateBps(money(100n, "XOF"), 12.5)).toThrow(TypeError);
  });
});
