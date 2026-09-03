import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allocate, AllocationError, amountOf, money, sum, type SplitLine } from "./index";

describe("allocate — the residual rule", () => {
  it("reproduces the documented sale exactly", () => {
    // 10 000 XOF, 18% platform commission, referral at 10% OF THE COMMISSION.
    const split = allocate(money(10_000n, "XOF"), {
      lines: [
        { key: "platform", basis: "gross", rateBps: 1800 },
        { key: "referral", basis: { line: "platform" }, rateBps: 1000, deductFrom: "platform" },
      ],
      residualTo: "seller",
    });

    expect(amountOf(split, "seller").amountMinor).toBe(8_200n);
    expect(amountOf(split, "platform").amountMinor).toBe(1_620n);
    expect(amountOf(split, "referral").amountMinor).toBe(180n);
  });

  it("refuses a deduction larger than its source", () => {
    expect(() =>
      allocate(money(10_000n, "XOF"), {
        lines: [
          { key: "platform", basis: "gross", rateBps: 100 },
          { key: "referral", basis: "gross", rateBps: 5000, deductFrom: "platform" },
        ],
        residualTo: "seller",
      }),
    ).toThrow(AllocationError);
  });

  it("refuses lines that exceed the gross", () => {
    expect(() =>
      allocate(money(100n, "XOF"), {
        lines: [
          { key: "a", basis: "gross", rateBps: 6000 },
          { key: "b", basis: "gross", rateBps: 6000 },
        ],
        residualTo: "seller",
      }),
    ).toThrow(AllocationError);
  });

  it("refuses a line whose basis is not defined before it", () => {
    expect(() =>
      allocate(money(100n, "XOF"), {
        lines: [{ key: "referral", basis: { line: "platform" }, rateBps: 1000 }],
        residualTo: "seller",
      }),
    ).toThrow(AllocationError);
  });

  it("refuses a residual holder that is also a line", () => {
    expect(() =>
      allocate(money(100n, "XOF"), {
        lines: [{ key: "seller", basis: "gross", rateBps: 10 }],
        residualTo: "seller",
      }),
    ).toThrow(AllocationError);
  });

  describe("properties", () => {
    const gross = fc.bigInt({ min: 0n, max: 10n ** 12n });
    const bps = fc.integer({ min: 0, max: 10_000 });

    it("always re-sums to the gross, whatever the rates", () => {
      fc.assert(
        fc.property(gross, bps, fc.option(bps, { nil: undefined }), (amount, platformBps, referralBps) => {
          const lines: SplitLine[] = [{ key: "platform", basis: "gross", rateBps: platformBps }];
          if (referralBps !== undefined) {
            lines.push({
              key: "referral",
              basis: { line: "platform" },
              rateBps: referralBps,
              deductFrom: "platform",
            });
          }
          const split = allocate(money(amount, "XOF"), { lines, residualTo: "seller" });
          const total = sum([...split.amounts.values()], "XOF");
          // No minor unit is created or destroyed by rounding.
          expect(total.amountMinor).toBe(amount);
        }),
        { numRuns: 2000 },
      );
    });

    it("never produces a negative share", () => {
      fc.assert(
        fc.property(gross, bps, bps, (amount, platformBps, referralBps) => {
          const split = allocate(money(amount, "XOF"), {
            lines: [
              { key: "platform", basis: "gross", rateBps: platformBps },
              { key: "referral", basis: { line: "platform" }, rateBps: referralBps, deductFrom: "platform" },
            ],
            residualTo: "seller",
          });
          for (const value of split.amounts.values()) {
            expect(value.amountMinor >= 0n).toBe(true);
          }
        }),
        { numRuns: 1000 },
      );
    });

    it("referral never exceeds what the platform earned — the confirmed guardrail", () => {
      fc.assert(
        fc.property(gross, bps, bps, (amount, platformBps, referralBps) => {
          const split = allocate(money(amount, "XOF"), {
            lines: [
              { key: "platform", basis: "gross", rateBps: platformBps },
              { key: "referral", basis: { line: "platform" }, rateBps: referralBps, deductFrom: "platform" },
            ],
            residualTo: "seller",
          });
          const platformRaw = (amount * BigInt(platformBps) + 5000n) / 10_000n;
          const referral = amountOf(split, "referral").amountMinor;
          // The ambassador can never be paid more than Afrinext earned on the sale.
          expect(referral <= platformRaw).toBe(true);
        }),
        { numRuns: 1000 },
      );
    });

    it("gives the rounding remainder to the seller, never to the platform", () => {
      fc.assert(
        fc.property(gross, bps, (amount, platformBps) => {
          const split = allocate(money(amount, "XOF"), {
            lines: [{ key: "platform", basis: "gross", rateBps: platformBps }],
            residualTo: "seller",
          });
          const platform = amountOf(split, "platform").amountMinor;
          const seller = amountOf(split, "seller").amountMinor;
          expect(platform + seller).toBe(amount);
        }),
        { numRuns: 1000 },
      );
    });
  });
});
