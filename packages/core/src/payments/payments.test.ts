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
  it("creates a charge PENDING, and reports its amount", async () => {
    /*
     * Pending, not succeeded — the mock is asynchronous by default now.
     *
     * It used to answer "succeeded" the moment a charge was created, and that
     * shape quietly permits an order domain written as "call the provider,
     * believe the reply". No hosted-redirect provider behaves that way, so the
     * default was changed to the one that forces a verification boundary to
     * exist. The synchronous mode is still available and still tested below.
     */
    const provider = new MockPaymentProvider();
    const result = await provider.createCharge(charge);
    expect(result.status).toBe("pending");
    const status = await provider.getCharge(result.providerRef);
    expect(status.amount.amountMinor).toBe(10_000n);
  });

  it("can still resolve a charge synchronously when asked to", async () => {
    const provider = new MockPaymentProvider({ asynchronous: false });
    const result = await provider.createCharge(charge);
    expect(result.status).toBe("succeeded");
  });

  it("gives every charge a reference unique beyond this process", async () => {
    // Two instances, as two server restarts would be. Afrinext stores the
    // reference under a unique index, so a counter that restarts at one
    // collides with rows the previous process wrote.
    const first = await new MockPaymentProvider().createCharge(charge);
    const second = await new MockPaymentProvider().createCharge(charge);
    expect(second.providerRef).not.toBe(first.providerRef);
  });

  it("signs an event that verifies, and refuses one that was altered", async () => {
    const provider = new MockPaymentProvider();
    const created = await provider.createCharge(charge);
    const event = provider.event({
      id: "evt-1", providerRef: created.providerRef, status: "succeeded",
      amountMinor: 10_000n, currency: "XOF",
    });

    const verified = await provider.verifyWebhook(event.body, event.headers);
    expect(verified.providerEventId).toBe("evt-1");
    expect(verified.amount?.amountMinor).toBe(10_000n);

    // The signature covers the bytes. Change the bytes and it must not verify,
    // which is the property a parse-then-check implementation loses.
    const tampered = Buffer.from(event.body.toString("utf8").replace("10000", "1"), "utf8");
    await expect(provider.verifyWebhook(tampered, event.headers)).rejects.toThrow(/signature/i);
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
    const allowed = process.env["ALLOW_MOCK_PAYMENTS"];
    try {
      process.env["NODE_ENV"] = "production";
      delete process.env["ALLOW_MOCK_PAYMENTS"];
      // A misconfigured environment must stop the process, not quietly accept
      // payments that never happened. PAYMENT_PROVIDER is precisely the
      // variable a deployment gets wrong, so getting it wrong is not enough.
      expect(() => createPaymentProvider("mock")).toThrow(ProviderNotConfiguredError);
      expect(() => new MockPaymentProvider()).toThrow(/refuses to run with NODE_ENV=production/i);
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
      if (allowed === undefined) delete process.env["ALLOW_MOCK_PAYMENTS"];
      else process.env["ALLOW_MOCK_PAYMENTS"] = allowed;
    }
  });

  it("takes a SECOND deliberate variable to permit the mock under a production build", () => {
    /*
     * The browser suite runs `next start`, which means NODE_ENV=production even
     * though nothing is taking real money. Rather than exempt the test suite —
     * which would leave the guard untested where it matters — the escape hatch
     * is named after what it permits and has to be set on its own.
     *
     * This test is the record of that decision, and of its shape: one wrong
     * variable is still refused, two deliberate ones are honoured.
     */
    const previous = process.env["NODE_ENV"];
    const allowed = process.env["ALLOW_MOCK_PAYMENTS"];
    try {
      process.env["NODE_ENV"] = "production";
      process.env["ALLOW_MOCK_PAYMENTS"] = "yes";
      expect(createPaymentProvider("mock").id).toBe("mock");
      expect(new MockPaymentProvider().id).toBe("mock");

      // Anything other than an exact "yes" is not a statement of intent.
      process.env["ALLOW_MOCK_PAYMENTS"] = "true";
      expect(() => new MockPaymentProvider()).toThrow(/refuses to run/i);
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
      if (allowed === undefined) delete process.env["ALLOW_MOCK_PAYMENTS"];
      else process.env["ALLOW_MOCK_PAYMENTS"] = allowed;
    }
  });
});
