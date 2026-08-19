import { describe, expect, it } from "vitest";
import {
  createCurrencyRegistry, formatMoney, ISO_MINOR_UNITS, money,
  parseMoney, UnknownCurrencyError,
} from "./index";

const registry = createCurrencyRegistry([
  { code: "XOF", minorUnit: 0 },
  { code: "NGN", minorUnit: 2 },
]);

/** Thousands are grouped with a narrow no-break space, the francophone convention. */
const NNBSP = "\u202F";

describe("currency exponents", () => {
  it("treats XOF as a zero-decimal currency", () => {
    // The trap this guards: assuming 100 minor units per major unit would make
    // every XOF amount wrong by a factor of 100.
    expect(ISO_MINOR_UNITS["XOF"]).toBe(0);
    expect(ISO_MINOR_UNITS["XAF"]).toBe(0);
    expect(formatMoney(money(10_000n, "XOF"), registry)).toBe(`10${NNBSP}000 XOF`);
  });

  it("treats NGN as a two-decimal currency", () => {
    expect(formatMoney(money(10_000n, "NGN"), registry)).toBe("100.00 NGN");
  });

  it("round-trips through parse and format", () => {
    expect(parseMoney(`10${NNBSP}000`, "XOF", registry).amountMinor).toBe(10_000n);
    expect(parseMoney("100.00", "NGN", registry).amountMinor).toBe(10_000n);
    expect(parseMoney("100,50", "NGN", registry).amountMinor).toBe(10_050n);
  });

  it("rejects more decimals than the currency has, rather than rounding silently", () => {
    expect(() => parseMoney("100.5", "XOF", registry)).toThrow(TypeError);
    expect(() => parseMoney("100.505", "NGN", registry)).toThrow(TypeError);
  });

  it("rejects an unregistered currency instead of guessing", () => {
    expect(() => registry.require("ZZZ")).toThrow(UnknownCurrencyError);
    expect(() => formatMoney(money(1n, "ZZZ"), registry)).toThrow(UnknownCurrencyError);
  });

  it("formats negative amounts", () => {
    expect(formatMoney(money(-1_500n, "XOF"), registry)).toBe(`-1${NNBSP}500 XOF`);
  });

  it("rejects an implausible minor unit at registry construction", () => {
    expect(() => createCurrencyRegistry([{ code: "BAD", minorUnit: 9 }])).toThrow(RangeError);
  });
});
