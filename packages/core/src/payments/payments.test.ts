import { describe, expect, it } from "vitest";
import { ProviderNotConfiguredError } from "../errors";
import { money } from "../money";
import { IPayMoneyProvider } from "./ipaymoney";
import { MockPaymentProvider } from "./mock";
import { createPaymentProvider } from "./registry";
import { supportsPayouts } from "./provider";

const charge = {
  reference: "order-1",
  amount: money(10_000n, "XOF"),
  customer: { userId: "u1" },
  idempotencyKey: "idem-1",
};

describe("iPayMoney adapter", () => {
  // iPayMoney is the confirmed provider, but nothing about its API has been
  // verified. A stub returning plausible data would let the system appear to
  // work and fail in production, on money — so every method throws instead.
  const provider = new IPayMoneyProvider();

  it("reports itself as unconfigured", () => {
    expect(provider.id).toBe("ipaymoney");
    expect(provider.isConfigured).toBe(false);
  });

  it("refuses every operation, naming what is missing", async () => {
    await expect(provider.createCharge(charge)).rejects.toThrow(ProviderNotConfiguredError);
    await expect(provider.getCharge("x")).rejects.toThrow(ProviderNotConfiguredError);
    await expect(provider.verifyWebhook(Buffer.from("{}"), { get: () => null })).rejects.toThrow(
      ProviderNotConfiguredError,
    );
    await expect(
      provider.refund({ providerRef: "x", amount: money(1n, "XOF"), reason: "r", idempotencyKey: "k" }),
    ).rejects.toThrow(ProviderNotConfiguredError);

    await expect(provider.createCharge(charge)).rejects.toThrow(/documentation is not available/i);
  });

  it("does not claim payout support it has not verified", () => {
    // Declaring createPayout would assert an answer we do not have.
    expect(supportsPayouts(provider)).toBe(false);
  });
});

describe("mock provider", () => {
  it("captures a charge and reports it", async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.createCharge(charge);
    expect(result.status).toBe("succeeded");
    const status = await provider.getCharge(result.providerRef);
    expect(status.amount.amountMinor).toBe(10_000n);
  });

  it("is idempotent on the charge key", async () => {
    const provider = new MockPaymentProvider();
    const a = await provider.createCharge(charge);
    const b = await provider.createCharge(charge);
    expect(b.providerRef).toBe(a.providerRef);
  });

  it("fails a charge whose reference is marked to fail", async () => {
    const provider = new MockPaymentProvider();
    const result = await provider.createCharge({ ...charge, reference: "order-FAIL" });
    expect(result.status).toBe("failed");
  });

  it("verifies a webhook against the raw body and rejects a bad signature", async () => {
    const provider = new MockPaymentProvider();
    const body = Buffer.from(
      JSON.stringify({
        id: "evt_1", type: "charge.succeeded", providerRef: "mockchg_00000001",
        status: "succeeded", amountMinor: "10000", currency: "XOF",
      }),
    );
    const signature = provider.signWebhook(body);

    const event = await provider.verifyWebhook(body, {
      get: (n) => (n === "x-mock-signature" ? signature : null),
    });
    expect(event.providerEventId).toBe("evt_1");
    expect(event.amount?.amountMinor).toBe(10_000n);

    await expect(
      provider.verifyWebhook(body, { get: () => "deadbeef" }),
    ).rejects.toThrow(/signature/i);
    await expect(provider.verifyWebhook(body, { get: () => null })).rejects.toThrow(/missing/i);
  });

  it("rejects a tampered body under a valid-length signature", async () => {
    const provider = new MockPaymentProvider();
    const body = Buffer.from(JSON.stringify({ id: "evt_2", type: "t", providerRef: "r", status: "succeeded" }));
    const signature = provider.signWebhook(body);
    const tampered = Buffer.from(JSON.stringify({ id: "evt_2", type: "t", providerRef: "r", status: "failed" }));
    await expect(
      provider.verifyWebhook(tampered, { get: () => signature }),
    ).rejects.toThrow(/signature/i);
  });

  it("supports payouts, so the payout path can be exercised end to end", () => {
    expect(supportsPayouts(new MockPaymentProvider())).toBe(true);
  });
});

describe("provider registry", () => {
  it("resolves the mock outside production", () => {
    expect(createPaymentProvider("mock").id).toBe("mock");
  });

  it("resolves the iPayMoney boundary", () => {
    expect(createPaymentProvider("ipaymoney").id).toBe("ipaymoney");
  });

  it("refuses an unknown provider rather than falling back", () => {
    expect(() => createPaymentProvider("stripe")).toThrow(ProviderNotConfiguredError);
  });

  it("never hands out the mock in production", () => {
    const previous = process.env["NODE_ENV"];
    try {
      process.env["NODE_ENV"] = "production";
      // A misconfigured environment must stop the process, not quietly accept
      // payments that never happened.
      expect(() => createPaymentProvider("mock")).toThrow(ProviderNotConfiguredError);
      expect(() => new MockPaymentProvider()).toThrow(/never be constructed in production/i);
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
    }
  });
});
