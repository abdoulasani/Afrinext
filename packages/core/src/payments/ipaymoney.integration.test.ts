import { describe, expect, it } from "vitest";
import { LAUNCH_PAYMENT_CHANNEL } from "./channel";
import { money } from "../money";
import { IPayMoneyProvider } from "./ipaymoney";
import { ProviderTransportError } from "./refund-outcome";

/**
 * REAL SANDBOX TESTS — these talk to iPayMoney over the network.
 *
 * Everything here is SKIPPED unless real sandbox credentials are present, and
 * that gate is the honest part of the file. As of this commit **no request has
 * ever been made to iPayMoney from this repository**: nothing below has run,
 * and nothing below may be quoted as evidence of how the provider behaves.
 *
 * The difference from `ipaymoney.test.ts` is the whole point:
 *
 *   ipaymoney.test.ts             LOCAL. An injected fetch. Proves our
 *                                 translation of the documentation is faithful
 *                                 to how we read it. Runs in CI, always.
 *
 *   ipaymoney.integration.test.ts REAL. Proves the documentation is true.
 *                                 Runs only where credentials exist.
 *
 * A green local suite says the adapter is self-consistent. Only this file can
 * say iPayMoney agrees.
 *
 * To run:
 *
 *   IPAYMONEY_BASE_URL=https://i-pay.money \
 *   IPAYMONEY_API_KEY=<sandbox secret key> \
 *   IPAYMONEY_ENVIRONMENT=sandbox \
 *   pnpm --filter @afrinext/core test -- src/payments/ipaymoney.integration.test.ts
 *
 * The key is a SECRET. It goes in the environment, never in this repository,
 * and never in a CI log.
 */

const baseUrl = process.env["IPAYMONEY_BASE_URL"];
const apiKey = process.env["IPAYMONEY_API_KEY"];
const environment = process.env["IPAYMONEY_ENVIRONMENT"];

/**
 * Sandbox only, and checked rather than assumed.
 *
 * These tests create payments. Running them against `live` would create real
 * ones, so the gate requires the environment to say `sandbox` explicitly — a
 * missing or mistyped value skips rather than proceeds.
 */
export function sandboxIsExplicitlyEnabled(env: {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  environment?: string | undefined;
}): boolean {
  return (
    typeof env.baseUrl === "string" && env.baseUrl !== "" &&
    typeof env.apiKey === "string" && env.apiKey !== "" &&
    // Exact match. Not `!== "live"`, not a case-insensitive compare, not a
    // prefix: anything other than the literal word skips.
    env.environment === "sandbox"
  );
}

const hasSandbox = sandboxIsExplicitlyEnabled({ baseUrl, apiKey, environment });

/**
 * The documented sandbox test numbers (extract L148–L159).
 *
 * The `scenario` is iPayMoney's word for the behaviour the number triggers. It
 * is NOT a status value: the documentation never states which `status` string a
 * declined payment carries, which is exactly what these tests are for.
 */
const SANDBOX_MSISDNS = [
  { msisdn: "40410000000", scenario: "success" },
  { msisdn: "40410000001", scenario: "success" },
  { msisdn: "40410000002", scenario: "error" },
  { msisdn: "40410000003", scenario: "error" },
  { msisdn: "40410000004", scenario: "insufficient_fund" },
  { msisdn: "40410000005", scenario: "insufficient_fund" },
  { msisdn: "40410000006", scenario: "declined" },
  { msisdn: "40410000007", scenario: "declined" },
  { msisdn: "40410000008", scenario: "pending" },
  { msisdn: "40410000009", scenario: "pending" },
] as const;

function provider(): IPayMoneyProvider {
  return new IPayMoneyProvider({ baseUrl, apiKey, environment, timeoutMs: 30_000 });
}

/** A reference iPayMoney has not seen: it refuses a reuse with 422. */
function freshTransactionId(tag: string): string {
  return `afrinext-sbx-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function chargeFor(msisdn: string, tag: string) {
  return {
    reference: `sandbox-${tag}`,
    // 100 is the documented minimum ("un montant supérieur à 100").
    amount: money(150n, "XOF"),
    customer: { userId: "sandbox", phone: msisdn },
    channel: LAUNCH_PAYMENT_CHANNEL,
    idempotencyKey: freshTransactionId(tag),
    metadata: { country: "NE", customerName: "Afrinext Sandbox" },
  };
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasSandbox)("iPayMoney sandbox — REAL requests", () => {
  it("creates a payment and receives a reference", async () => {
    const result = await provider().createCharge(chargeFor("40410000000", "create"));
    expect(result.providerRef).toMatch(/\S/);
    // Whatever it says, record it: this is the first real evidence of the
    // synchronous status for a success scenario.
    expect(["succeeded", "pending", "failed"]).toContain(result.status);
  });

  it("answers a status query for a reference it gave us", async () => {
    const created = await provider().createCharge(chargeFor("40410000000", "status"));
    const status = await provider().getCharge(created.providerRef);
    expect(status.providerRef).toBe(created.providerRef);
  });

  it("CONFIRMS OR REFUTES that no amount is returned", async () => {
    /*
     * Finding F1 / question K8, tested rather than assumed.
     *
     * The documentation shows no amount in the status response. If that is
     * right, `amount` is undefined and `statesChargeAmount` is correctly false.
     * If an amount DOES come back, this test fails loudly and the adapter's
     * declared capability is wrong in our favour — which is a change worth
     * making deliberately.
     */
    const created = await provider().createCharge(chargeFor("40410000000", "amount"));
    const status = await provider().getCharge(created.providerRef);
    expect(
      status.amount,
      "if this is defined, iPayMoney DOES state the amount and statesChargeAmount must become true",
    ).toBeUndefined();
  });

  it("refuses a reused transaction_id with 422 rather than replaying the original", async () => {
    /*
     * Question K10. A reuse is documented to answer "External Reference Not
     * Valid". That is safe — it cannot double-charge — but it is a REJECTION,
     * not an idempotent replay, so a retry after a lost response learns nothing
     * about the first attempt.
     */
    const charge = chargeFor("40410000000", "dup");
    await provider().createCharge(charge);
    await expect(provider().createCharge(charge)).rejects.toThrow();
  });

  it.each(SANDBOX_MSISDNS.filter((s) => s.scenario !== "pending"))(
    "records the real status for the $scenario scenario ($msisdn)",
    async ({ msisdn, scenario }) => {
      /*
       * This is the test that completes the status enumeration — question K12.
       *
       * The adapter REFUSES an undocumented status rather than guessing, so a
       * scenario whose status string is not `succeeded` or `failed` makes this
       * throw with the exact value in the message. That failure is the
       * deliverable: read the value, confirm it with iPayMoney, add it to
       * IPAYMONEY_STATUS_MAP on evidence.
       */
      const charge = chargeFor(msisdn, scenario);
      const result = await provider()
        .createCharge(charge)
        .catch((error: unknown) => {
          throw new Error(
            `scenario ${scenario} (${msisdn}) produced: ${String(error)}. If this is ` +
              "an unknown status, that string is the evidence needed to complete " +
              "IPAYMONEY_STATUS_MAP.",
          );
        });
      expect(result.providerRef).toMatch(/\S/);
    },
  );

  it(
    "exercises the 180-second pending scenario against the real provider",
    { timeout: 240_000 },
    async () => {
      /*
       * The most valuable scenario in the sandbox, and the reason this
       * milestone cares about it.
       *
       * Three minutes of genuine in-flight state is what lets the late-payment
       * policy be tested against a real provider instead of a mock: the order
       * expires locally while the payment is still pending at iPayMoney, and
       * the confirmation then arrives late. Everything the mock proves about
       * the grace window is proved against our own fixture; this is the only
       * way to prove it against the thing that actually decides.
       *
       * This test only establishes the PROVIDER's behaviour. Wiring it to a
       * real order and asserting the grace window end to end needs a publicly
       * reachable URL for iPayMoney to call, which this environment does not
       * have; `ipaymoney-replay.test.ts` proves the domain side against an
       * injected transport instead.
       */
      const created = await provider().createCharge(chargeFor("40410000008", "pending"));
      const first = await provider().getCharge(created.providerRef);

      // Poll past the documented 180 seconds, then read it again.
      await new Promise((resolve) => setTimeout(resolve, 190_000));
      const settled = await provider().getCharge(created.providerRef);

      expect(
        { first: first.status, settled: settled.status },
        "record both: this is the documented pending window observed for real",
      ).toBeDefined();
    },
  );

  it("classifies an unreachable host as NOT TRANSMITTED, against a real socket", async () => {
    /*
     * The classifier's table, exercised against a real DNS failure rather than
     * a synthesised error code. `not_transmitted` is the only stage that may
     * ever become a definite failure, so it is worth confirming that a real
     * resolution failure lands there.
     */
    const unreachable = new IPayMoneyProvider({
      baseUrl: "https://i-pay.money.invalid",
      apiKey,
      environment,
      timeoutMs: 5_000,
    });
    const error = await unreachable
      .createCharge(chargeFor("40410000000", "dns"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).stage).toBe("not_transmitted");
  });
});

/**
 * What CANNOT be tested in the sandbox, recorded so nobody looks for it.
 */
describe.skipIf(!hasSandbox)("iPayMoney sandbox — out of reach", () => {
  it("cannot exercise a refund, because there is no refund operation", async () => {
    /*
     * Not "not yet implemented" — there is nothing to call. iPayMoney documents
     * no customer-refund API at any endpoint, so no sandbox scenario can
     * exercise one. Questions K1 and K5.
     */
    await expect(
      provider().refund({
        providerRef: "anything", amount: money(150n, "XOF"),
        reason: "sandbox", idempotencyKey: "k",
      }),
    ).rejects.toThrow(/documents no customer-refund API/i);
  });

  it("cannot exercise a webhook end to end, because the sandbox cannot deliver one", async () => {
    /*
     * `verifyWebhook` IS implemented, and `ipaymoney.test.ts` proves its
     * behaviour against an injected transport. What no test in this file can do
     * is make iPayMoney deliver a notification to a machine with no public URL,
     * so the one property only a real delivery can establish — which header
     * name arrives, and whether its value is the secret or a signature — stays
     * open as question K7.
     *
     * What IS reachable here is the refusal path, and it is worth exercising
     * against the real client: a body carrying no reference is rejected before
     * any lookup, so nothing is confirmed and no request is made.
     */
    await expect(
      provider().verifyWebhook(
        Buffer.from(JSON.stringify({ data: { status: "succeeded" } }), "utf8"),
        { get: () => apiKey ?? "" },
      ),
    ).rejects.toThrow(/names no payment reference/i);
  });
});

/**
 * This one ALWAYS runs, so the test output distinguishes "skipped" from
 * "passed" without anybody reading the config.
 */
describe("iPayMoney sandbox availability", () => {
  it("reports whether real sandbox tests ran", () => {
    if (hasSandbox) {
      expect(environment).toBe("sandbox");
      return;
    }
    /*
     * No credentials, so every real test above was skipped and NOTHING in this
     * repository has been verified against iPayMoney. Asserting the gate keeps
     * that fact in the test output rather than in a comment somebody may not
     * read.
     */
    expect(hasSandbox).toBe(false);
  });
});

/**
 * The gate itself, exhaustively — and this ALWAYS runs.
 *
 * "Fails closed" is a claim about what happens when something is wrong, so it
 * cannot be demonstrated by a suite that only ever runs when everything is
 * right. These cases are the ones that would cost real money if the gate were
 * generous, and none of them needs a credential to check.
 */
describe("the sandbox gate fails closed", () => {
  const creds = { baseUrl: "https://i-pay.money", apiKey: "sk_whatever" };

  it("opens ONLY for the exact word sandbox", () => {
    expect(sandboxIsExplicitlyEnabled({ ...creds, environment: "sandbox" })).toBe(true);
  });

  it("refuses live, and every way of nearly writing sandbox", () => {
    for (const environment of [
      "live", "LIVE", "Live", "production", "prod",
      "Sandbox", "SANDBOX", " sandbox", "sandbox ", "sandbox2", "sand", "",
    ]) {
      expect(
        sandboxIsExplicitlyEnabled({ ...creds, environment }),
        `environment=${JSON.stringify(environment)} must not enable real requests`,
      ).toBe(false);
    }
  });

  it("refuses a missing environment", () => {
    expect(sandboxIsExplicitlyEnabled({ ...creds })).toBe(false);
    expect(sandboxIsExplicitlyEnabled({ ...creds, environment: undefined })).toBe(false);
  });

  it("refuses when either credential is absent or empty", () => {
    expect(sandboxIsExplicitlyEnabled({ apiKey: "sk_x", environment: "sandbox" })).toBe(false);
    expect(sandboxIsExplicitlyEnabled({ baseUrl: "https://i-pay.money", environment: "sandbox" }))
      .toBe(false);
    expect(sandboxIsExplicitlyEnabled({ baseUrl: "", apiKey: "sk_x", environment: "sandbox" }))
      .toBe(false);
    expect(sandboxIsExplicitlyEnabled({ baseUrl: "https://i-pay.money", apiKey: "", environment: "sandbox" }))
      .toBe(false);
  });

  it("cannot be opened by an unrelated variable", () => {
    expect(
      sandboxIsExplicitlyEnabled({
        ...creds,
        ...({ IS_SANDBOX: "true", NODE_ENV: "test" } as unknown as { environment?: string }),
      }),
      "only IPAYMONEY_ENVIRONMENT decides",
    ).toBe(false);
  });
});
