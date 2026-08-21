import { describe, expect, it } from "vitest";
import { IPAYMONEY_PAYMENT_TYPE } from "./ipaymoney";
import {
  isPaymentChannel, LAUNCH_PAYMENT_CHANNEL, parsePaymentChannel, PAYMENT_CHANNELS,
  UnsupportedPaymentChannelError,
} from "./channel";

/**
 * The launch channel, and the boundary between Afrinext's vocabulary and
 * iPayMoney's.
 *
 * The provider value is quoted from the documentation, not chosen:
 *
 *   « Ipay-Payment-Type | string | Doit comporter *mobile* ou *card* »
 *     — extract L165 (POST /api/v1/payments)
 *     — extract L238 (GET  /api/v1/payments/{reference})
 */

describe("the launch channel", () => {
  it("is exactly one, and it is mobile money", () => {
    expect(PAYMENT_CHANNELS).toEqual(["mobile_money"]);
    expect(LAUNCH_PAYMENT_CHANNEL).toBe("mobile_money");
  });

  it("maps to the DOCUMENTED provider value, verbatim", () => {
    expect(IPAYMONEY_PAYMENT_TYPE[LAUNCH_PAYMENT_CHANNEL]).toBe("mobile");
  });

  it("has no mapping for a channel Afrinext does not offer", () => {
    /*
     * `card` is a documented iPayMoney value and deliberately absent. A mapping
     * entry for a channel the business has not adopted is a route to sending
     * one.
     */
    expect(Object.keys(IPAYMONEY_PAYMENT_TYPE)).toEqual(["mobile_money"]);
    expect(Object.values(IPAYMONEY_PAYMENT_TYPE)).not.toContain("card");
  });

  it("is frozen, so nothing can add a channel at runtime", () => {
    expect(Object.isFrozen(IPAYMONEY_PAYMENT_TYPE)).toBe(true);
  });
});

describe("parsing an untrusted channel", () => {
  it("accepts the launch channel", () => {
    expect(parsePaymentChannel("mobile_money")).toBe("mobile_money");
    expect(isPaymentChannel("mobile_money")).toBe(true);
  });

  it("REFUSES the provider's own vocabulary", () => {
    /*
     * The important case. `mobile` and `card` are readable straight out of this
     * repository and out of iPayMoney's public documentation, so they are
     * exactly what an attacker would try. The domain does not accept provider
     * values, so naming one is no more effective than naming nonsense.
     */
    for (const provider of ["mobile", "card"]) {
      expect(() => parsePaymentChannel(provider), provider)
        .toThrow(UnsupportedPaymentChannelError);
      expect(isPaymentChannel(provider)).toBe(false);
    }
  });

  it("refuses a missing channel rather than defaulting one", () => {
    for (const absent of [undefined, null, ""]) {
      expect(() => parsePaymentChannel(absent)).toThrow(UnsupportedPaymentChannelError);
    }
  });

  it("refuses anything that is not exactly a listed value", () => {
    for (const junk of [
      "ussd", "bank_transfer", "MOBILE_MONEY", "Mobile_Money", " mobile_money",
      "mobile_money ", "mobile_money;card", 1, 0, true, false, {}, [], ["mobile_money"],
      Symbol("mobile_money"),
    ]) {
      expect(() => parsePaymentChannel(junk), String(junk))
        .toThrow(UnsupportedPaymentChannelError);
    }
  });

  it("names what is supported, without echoing the attempt into the code", () => {
    const error = new UnsupportedPaymentChannelError("card");
    expect(error.code).toBe("payments.channel_unsupported");
    expect(error.offered).toEqual(["mobile_money"]);
    expect(error.message).toMatch(/mobile_money/);
  });
});
