import { describe, expect, it } from "vitest";
import { LAUNCH_PAYMENT_CHANNEL } from "./channel";
import { ProviderNotConfiguredError } from "../errors";
import { money } from "../money";
import {
  IPAYMONEY_STATUS_MAP, ipaymoneyEventId, IPayMoneyProvider, IPayMoneyUnknownStatusError,
} from "./ipaymoney";
import { ProviderTransportError, stageOfTransportFailure } from "./refund-outcome";
import type { ChargeInput, HeadersLike } from "./provider";

/**
 * LOCAL TESTS — no network, no credentials, no iPayMoney.
 *
 * Every test in this file drives the adapter with an injected `fetch`, so what
 * is under test is OUR translation of the documented contract: the fields we
 * send, the headers we set, and — mostly — what we refuse to conclude.
 *
 * These prove nothing about iPayMoney's actual behaviour. They cannot: no
 * request has ever been made to it from this repository. Confirming that the
 * real provider behaves as documented is what `ipaymoney.integration.test.ts`
 * is for, and it stays skipped until somebody supplies sandbox credentials.
 *
 * The distinction is the point. A test that passes here means "the adapter is
 * faithful to the documentation as we read it", never "iPayMoney does this".
 */

const CHARGE: ChargeInput = {
  reference: "order-abc",
  amount: money(15_000n, "XOF"),
  customer: { userId: "u1", phone: "40410000000" },
  channel: LAUNCH_PAYMENT_CHANNEL,
  idempotencyKey: "order:abc:charge",
  metadata: { country: "NE", customerName: "Aïcha Issoufou" },
};

/** A provider wired to a fetch we control, configured for sandbox. */
function withFetch(impl: typeof fetch): IPayMoneyProvider {
  return new IPayMoneyProvider({
    baseUrl: "https://i-pay.money",
    apiKey: "sk_test_not_a_real_key",
    environment: "sandbox",
    fetchImpl: impl,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Captures what the adapter sent, so the request can be asserted field by field. */
function capturing(response: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(response());
  }) as unknown as typeof fetch;
  return { calls, impl };
}

// ---------------------------------------------------------------------------

describe("configuration", () => {
  it("is not configured without credentials", () => {
    expect(new IPayMoneyProvider({ apiKey: undefined, environment: undefined }).isConfigured)
      .toBe(false);
  });

  it("refuses to default the environment, because the default would decide about real money", () => {
    // A key but no environment. `Ipay-Target-Environment` chooses between
    // sandbox and live, so silently picking one is picking whether a request
    // moves money.
    const p = new IPayMoneyProvider({ apiKey: "sk_x", environment: undefined });
    expect(p.isConfigured).toBe(false);
  });

  it("refuses an environment that is neither sandbox nor live", () => {
    expect(new IPayMoneyProvider({ apiKey: "sk_x", environment: "staging" }).isConfigured)
      .toBe(false);
  });

  it("is configured with a key and an explicit environment", () => {
    expect(new IPayMoneyProvider({ apiKey: "sk_x", environment: "sandbox" }).isConfigured)
      .toBe(true);
  });

  it("reports a missing credential as NOT TRANSMITTED, never as unknown", async () => {
    /*
     * A regression test for a real bug this adapter shipped with for one run.
     *
     * The credential check lived inside the transport try/catch, so "no API key
     * configured" came back as a transport failure of stage `unknown` — which
     * asserts the request may have reached iPayMoney and we cannot tell. The
     * truth is that with no credentials no request is ever built, so nothing
     * could have happened.
     *
     * The direction of that mistake is the one the whole refund phase exists to
     * prevent: it turns an operator error into an ambiguous payment. It must
     * stay a plain configuration refusal.
     */
    let fetched = false;
    const impl = (() => { fetched = true; return Promise.resolve(new Response("{}")); }) as
      unknown as typeof fetch;
    const unconfigured = new IPayMoneyProvider({ apiKey: undefined, environment: undefined, fetchImpl: impl });

    const error = await unconfigured.createCharge(CHARGE).catch((e: unknown) => e);

    /*
     * The assertion that matters is the CLASS, not the stage.
     *
     * `stageOfTransportFailure` answers "unknown" for anything it cannot
     * classify, and that default is right: it is a transport classifier, and
     * refusing to claim knowledge about an error it does not recognise is
     * exactly the conservative behaviour the refund phase requires of it. The
     * fix is that a configuration error never reaches it at all — it is not a
     * transport error and must not be dressed as one.
     */
    expect(error).toBeInstanceOf(ProviderNotConfiguredError);
    expect(error).not.toBeInstanceOf(ProviderTransportError);
    expect(fetched, "nothing may be sent without credentials").toBe(false);
  });

  it("declares that it never states the charged amount", () => {
    /*
     * The consequence is real: the webhook boundary's exact amount cross-check
     * has nothing to compare against for this provider. Asserting the flag here
     * means the day iPayMoney starts stating amounts, somebody has to change
     * this line deliberately.
     */
    expect(new IPayMoneyProvider().statesChargeAmount).toBe(false);
  });
});

describe("createCharge — what we send", () => {
  it("sends exactly the documented fields and headers", async () => {
    const { calls, impl } = capturing(() =>
      jsonResponse(200, { status: "succeeded", reference: "vslfxgawkpkm" }));

    await withFetch(impl).createCharge(CHARGE);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://i-pay.money/api/v1/payments");
    expect(calls[0]?.init.method).toBe("POST");

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Ipay-Payment-Type"]).toBe("mobile");
    expect(headers["Ipay-Target-Environment"]).toBe("sandbox");
    expect(headers["Authorization"]).toBe("Bearer sk_test_not_a_real_key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      customer_name: "Aïcha Issoufou",
      currency: "XOF",
      country: "NE",
      amount: "15000",
      transaction_id: "order:abc:charge",
      msisdn: "40410000000",
    });
  });

  it("sends the amount as whole francs, because XOF has no minor unit", async () => {
    const { calls, impl } = capturing(() =>
      jsonResponse(200, { status: "succeeded", reference: "r1" }));
    await withFetch(impl).createCharge({ ...CHARGE, amount: money(100n, "XOF") });
    const body = JSON.parse(calls[0]?.init.body as string) as { amount: string };
    // 100 minor units of XOF is 100 francs. If this ever reads "1" or "10000"
    // somebody has applied an exponent that XOF does not have.
    expect(body.amount).toBe("100");
  });

  it("refuses any currency but XOF rather than guessing its exponent", async () => {
    const { impl } = capturing(() => jsonResponse(200, { status: "succeeded", reference: "r" }));
    await expect(
      withFetch(impl).createCharge({ ...CHARGE, amount: money(15_000n, "NGN") }),
    ).rejects.toThrow(ProviderNotConfiguredError);
  });

  it("uses the derived idempotency key as transaction_id, never a caller value", async () => {
    const { calls, impl } = capturing(() =>
      jsonResponse(200, { status: "succeeded", reference: "r" }));
    await withFetch(impl).createCharge(CHARGE);
    const body = JSON.parse(calls[0]?.init.body as string) as { transaction_id: string };
    expect(body.transaction_id).toBe(CHARGE.idempotencyKey);
    // Not `reference`, which is our human-readable label.
    expect(body.transaction_id).not.toBe(CHARGE.reference);
  });

  it("refuses to invent the fields iPayMoney requires and ChargeInput does not carry", async () => {
    const { calls, impl } = capturing(() =>
      jsonResponse(200, { status: "succeeded", reference: "r" }));
    const provider = withFetch(impl);

    /*
     * `country` is documented only as "le code du pays de la transaction", and
     * whether that is the buyer's country or the merchant's is not stated —
     * question K17. Defaulting it to NE because Niger is the launch market
     * would bake a guess into every charge.
     */
    await expect(
      provider.createCharge({ ...CHARGE, metadata: { customerName: "X" } }),
    ).rejects.toThrow(/country/);

    await expect(
      provider.createCharge({ ...CHARGE, metadata: { country: "NE" } }),
    ).rejects.toThrow(/customer_name/);

    await expect(
      provider.createCharge({
        ...CHARGE,
        customer: { userId: "u1" },
        metadata: { country: "NE", customerName: "X" },
      }),
    ).rejects.toThrow(/msisdn/);

    /*
     * A channel the domain does not offer cannot even be expressed here any
     * more — `ChargeInput.channel` is the allowlist type — so the reachable
     * case is the absent one, which is what iPayMoney documents no default for.
     */
    await expect(
      provider.createCharge({ ...CHARGE, channel: undefined }),
    ).rejects.toThrow(/payment type|no payment channel/);

    /*
     * And metadata is NOT a back door to the header.
     *
     * `Ipay-Payment-Type` once fell back to `metadata["paymentType"]` when no
     * channel was given. Nothing in the order domain ever set that key, so the
     * path was unreachable from a checkout — and therefore invisible to every
     * test that starts from one. Mutation testing restored the fallback and
     * survived a green suite; this is the assertion that now kills it.
     *
     * The channel is the only thing that decides the header. A caller who knows
     * the key name gains nothing by using it.
     */
    await expect(
      provider.createCharge({
        ...CHARGE,
        channel: undefined,
        metadata: { ...CHARGE.metadata, paymentType: "mobile" },
      }),
    ).rejects.toThrow(/payment type|no payment channel/);

    // Nothing was sent in any of those cases.
    expect(calls).toHaveLength(0);
  });
});

describe("createCharge — what we conclude", () => {
  it("reports the provider's synchronous status faithfully, and lets the domain clamp it", async () => {
    const { impl } = capturing(() =>
      jsonResponse(200, { status: "succeeded", reference: "vslfxgawkpkm" }));
    const result = await withFetch(impl).createCharge(CHARGE);

    /*
     * The adapter says what the provider said. It is `initiatePayment` that
     * clamps anything short of a definite refusal to `pending` and confirms
     * nothing without a verified event — a Phase 2 decision, and this keeps the
     * two responsibilities where they were put rather than softening the truth
     * here and clamping twice.
     */
    expect(result.status).toBe("succeeded");
    expect(result.providerRef).toBe("vslfxgawkpkm");
  });

  it("treats a documented 4xx as a definite refusal — no payment was created", async () => {
    for (const status of [400, 401, 403, 406, 422]) {
      const { impl } = capturing(() =>
        jsonResponse(status, { message: "External Reference Not Valid" }));
      await expect(withFetch(impl).createCharge(CHARGE))
        .rejects.toThrow(ProviderNotConfiguredError);
    }
  });

  it("REFUSES to call a 5xx a failure, because nothing documents what it means", async () => {
    /*
     * The rule the refund path enforces, applied to charges. A 5xx says
     * iPayMoney's server had a problem. The documentation says nothing about
     * what that implies for the transaction — question K14 — so the outcome is
     * unknown and the bytes provably arrived.
     */
    for (const status of [500, 502, 503]) {
      const { impl } = capturing(() => jsonResponse(status, { message: "oops" }));
      const error = await withFetch(impl).createCharge(CHARGE).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderTransportError);
      expect((error as ProviderTransportError).stage).toBe("transmitted");
      expect((error as ProviderTransportError).stage).not.toBe("not_transmitted");
      expect(stageOfTransportFailure(error)).toBe("transmitted");
    }
  });

  it("treats a timeout as unknown, never as a failure", async () => {
    const impl = (() =>
      Promise.reject(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }))
    ) as unknown as typeof fetch;
    const error = await withFetch(impl).createCharge(CHARGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).stage).toBe("unknown");
  });

  it("treats a connection lost after transmission as unknown", async () => {
    const impl = (() =>
      Promise.reject(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
    ) as unknown as typeof fetch;
    const error = await withFetch(impl).createCharge(CHARGE).catch((e: unknown) => e);
    expect((error as ProviderTransportError).stage).toBe("unknown");
  });

  it("treats a DNS failure as proven not transmitted", async () => {
    const impl = (() =>
      Promise.reject(Object.assign(new Error("dns"), { code: "ENOTFOUND" }))
    ) as unknown as typeof fetch;
    const error = await withFetch(impl).createCharge(CHARGE).catch((e: unknown) => e);
    expect((error as ProviderTransportError).stage).toBe("not_transmitted");
  });

  it("treats a 200 with no reference as unknown — the payment may exist and be unnameable", async () => {
    const { impl } = capturing(() => jsonResponse(200, { status: "succeeded" }));
    const error = await withFetch(impl).createCharge(CHARGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).stage).toBe("transmitted");
  });
});

describe("status mapping is explicit, and refuses to guess", () => {
  it("maps only the two values the documentation shows", () => {
    expect(Object.keys(IPAYMONEY_STATUS_MAP).sort()).toEqual(["failed", "succeeded"]);
  });

  it("refuses an undocumented status rather than inventing a meaning", async () => {
    /*
     * The sandbox names five SCENARIOS — success, error, insufficient_fund,
     * declined, pending — and the documentation never shows which `status`
     * string a declined payment carries. Guessing "declined" means "failed"
     * would be plausible and unverified; refusing means the first sandbox run
     * reports the real value and it gets added on evidence.
     */
    for (const reported of ["pending", "declined", "insufficient_fund", "error", "", "SUCCEEDED"]) {
      const { impl } = capturing(() => jsonResponse(200, { status: reported, reference: "r" }));
      await expect(withFetch(impl).createCharge(CHARGE))
        .rejects.toThrow(IPayMoneyUnknownStatusError);
    }
  });

  it("names the value it refused, so the enumeration can be completed from evidence", async () => {
    const { impl } = capturing(() => jsonResponse(200, { status: "declined", reference: "r" }));
    await expect(withFetch(impl).createCharge(CHARGE)).rejects.toThrow(/"declined"/);
  });
});

describe("getCharge", () => {
  it("queries iPayMoney's reference, on the documented path", async () => {
    const { calls, impl } = capturing(() =>
      jsonResponse(200, {
        external_reference: "order:abc:charge",
        reference: "vslfxgawkpkm",
        status: "failed",
        msisdn: "22787505050",
      }));

    const status = await withFetch(impl).getCharge("vslfxgawkpkm");

    expect(calls[0]?.url).toBe("https://i-pay.money/api/v1/payments/vslfxgawkpkm");
    expect(calls[0]?.init.method).toBe("GET");
    expect(status.status).toBe("failed");
    expect(status.providerRef).toBe("vslfxgawkpkm");
  });

  it("returns NO amount, because iPayMoney states none", async () => {
    const { impl } = capturing(() =>
      jsonResponse(200, { reference: "r", status: "succeeded", msisdn: "227" }));
    const status = await withFetch(impl).getCharge("r");

    /*
     * Absent, not fabricated. Filling this in from our own order would be us
     * corroborating ourselves while wearing the provider's clothes — and it
     * would make the webhook boundary's amount check look satisfiable when it
     * is not.
     */
    expect(status.amount).toBeUndefined();
  });

  it("refuses to pretend our transaction_id is a lookup key", async () => {
    const { calls, impl } = capturing(() => jsonResponse(200, {}));
    await expect(withFetch(impl).getCharge("")).rejects.toThrow(/transaction_id is not a documented/);
    expect(calls).toHaveLength(0);
  });

  it("treats a 5xx on the status query as unknown too", async () => {
    const { impl } = capturing(() => jsonResponse(503, {}));
    const error = await withFetch(impl).getCharge("r").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).stage).toBe("transmitted");
  });
});

// ---------------------------------------------------------------------------
// The webhook, as a notification rather than as evidence
// ---------------------------------------------------------------------------

const SECRET = "sk_test_webhook_secret";

/** A provider whose lookups answer with whatever the test decides is true. */
function withLookup(
  truth: (ref: string) => Response,
  onCall?: (ref: string) => void,
): IPayMoneyProvider {
  const impl = ((url: string | URL | Request) => {
    const ref = String(url).split("/").pop() as string;
    onCall?.(ref);
    return Promise.resolve(truth(ref));
  }) as unknown as typeof fetch;
  return new IPayMoneyProvider({
    baseUrl: "https://i-pay.money",
    apiKey: "sk_x",
    environment: "sandbox",
    webhookSecret: SECRET,
    fetchImpl: impl,
  });
}

function notification(reference: string, claimedStatus: string): Buffer {
  return Buffer.from(JSON.stringify({
    data: {
      external_reference: "order:x:charge",
      reference,
      status: claimedStatus,
      msisdn: "40410000001",
    },
  }), "utf8");
}

const signed = (secret = SECRET): HeadersLike => ({
  get: (name: string) => (name.toLowerCase() === "secret-hash" ? secret : null),
});

describe("webhook — the notification is checked, then ignored as a source of truth", () => {
  it("refuses a webhook with no secret header", async () => {
    const provider = withLookup(() => jsonResponse(200, {}));
    await expect(
      provider.verifyWebhook(notification("r1", "succeeded"), { get: () => null }),
    ).rejects.toThrow(/neither secret-hash nor x-iPayMoney-secret/);
  });

  it("refuses a webhook whose secret does not match", async () => {
    let looked = false;
    const provider = withLookup(() => jsonResponse(200, {}), () => { looked = true; });
    await expect(
      provider.verifyWebhook(notification("r1", "succeeded"), signed("wrong-secret")),
    ).rejects.toThrow(/secret does not match/);
    // And no lookup was issued: a bad secret must not even cost us a request.
    expect(looked).toBe(false);
  });

  it("accepts either documented header name, because the documentation contradicts itself", async () => {
    const provider = withLookup(() =>
      jsonResponse(200, { reference: "r1", status: "succeeded" }));
    const viaProse: HeadersLike = {
      get: (n: string) => (n.toLowerCase() === "x-ipaymoney-secret" ? SECRET : null),
    };
    const event = await provider.verifyWebhook(notification("r1", "succeeded"), viaProse);
    expect(event.subject).toBe("charge");
  });

  it("TAKES THE STATUS FROM THE LOOKUP, not from what the notification claimed", async () => {
    /*
     * The whole point of the design, in one assertion.
     *
     * The notification claims the payment succeeded. The provider, asked
     * directly, says it failed. A forged or mistaken notification must not be
     * able to confirm money, so the confirmed answer wins.
     */
    const provider = withLookup(() =>
      jsonResponse(200, { reference: "r1", status: "failed", external_reference: "order:x" }));

    const event = await provider.verifyWebhook(notification("r1", "succeeded"), signed());

    expect(event.status).toBe("failed");
    expect(event.type).toBe("payment.failed");
  });

  it("a forged notification cannot confirm a payment that did not succeed", async () => {
    /*
     * The attack the shared-secret scheme would otherwise permit, run end to
     * end: somebody with the secret invents a success for a real payment. The
     * lookup is what refuses it.
     */
    const provider = withLookup(() => jsonResponse(200, { reference: "real-1", status: "failed" }));
    const event = await provider.verifyWebhook(notification("real-1", "succeeded"), signed());
    expect(event.status).not.toBe("succeeded");
  });

  it("confirms nothing when the lookup cannot be made", async () => {
    /*
     * A 5xx on the lookup means we could not establish the truth. Throwing
     * makes the route answer non-2xx, and iPayMoney retries — the event is not
     * lost, and an unconfirmable notification is not treated as a confirmation.
     */
    const provider = withLookup(() => jsonResponse(503, {}));
    await expect(provider.verifyWebhook(notification("r1", "succeeded"), signed()))
      .rejects.toThrow(ProviderTransportError);
  });

  it("states no amount, because iPayMoney states none in either channel", async () => {
    const provider = withLookup(() => jsonResponse(200, { reference: "r1", status: "succeeded" }));
    const event = await provider.verifyWebhook(notification("r1", "succeeded"), signed());
    expect("amount" in event ? event.amount : undefined).toBeUndefined();
  });

  it("keeps what was claimed alongside what was confirmed, screened", async () => {
    const provider = withLookup(() => jsonResponse(200, { reference: "r1", status: "failed" }));
    const event = await provider.verifyWebhook(notification("r1", "succeeded"), signed());
    const raw = event.raw as { claimed: string; confirmed: unknown };
    // A forgery attempt stays visible after the fact.
    expect(raw.claimed).toContain("succeeded");
    expect(raw.confirmed).toBeDefined();
  });

  it("refuses a notification that names no payment", async () => {
    const provider = withLookup(() => jsonResponse(200, {}));
    await expect(
      provider.verifyWebhook(Buffer.from(JSON.stringify({ data: {} })), signed()),
    ).rejects.toThrow(/names no payment reference/);
  });

  it("refuses a body that is not JSON, without asking anybody", async () => {
    let looked = false;
    const provider = withLookup(() => jsonResponse(200, {}), () => { looked = true; });
    await expect(provider.verifyWebhook(Buffer.from("<html>"), signed()))
      .rejects.toThrow(/not JSON/);
    expect(looked).toBe(false);
  });
});

describe("webhook — the derived event id", () => {
  it("is the same for five deliveries of one real event", async () => {
    /*
     * iPayMoney retries five times on any non-2xx, so duplicates are the
     * documented behaviour rather than a hazard to guard against.
     */
    const provider = withLookup(() =>
      jsonResponse(200, { reference: "r1", status: "succeeded" }));

    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const event = await provider.verifyWebhook(notification("r1", "succeeded"), signed());
      ids.add(event.providerEventId);
    }
    expect(ids.size, "five deliveries must deduplicate to one id").toBe(1);
  });

  it("cannot collide across different payments", () => {
    expect(ipaymoneyEventId("ref-a", "succeeded"))
      .not.toBe(ipaymoneyEventId("ref-b", "succeeded"));
  });

  it("does NOT collapse a success and a failure for the same payment", () => {
    /*
     * Keying on the reference alone would make a later, truthful event look
     * like a duplicate of an earlier, different one — and it would be silently
     * discarded by the replay index.
     */
    expect(ipaymoneyEventId("ref-a", "succeeded"))
      .not.toBe(ipaymoneyEventId("ref-a", "failed"));
  });

  it("is a function of the CONFIRMED status, so a forger cannot mint fresh ids", async () => {
    /*
     * If the id were keyed on the claimed status, anyone reaching the endpoint
     * could produce unlimited distinct ids — each one a row and a lookup. Keyed
     * on the confirmed status, every forgery about one payment collapses to the
     * one id the truth deserves.
     */
    const provider = withLookup(() => jsonResponse(200, { reference: "r1", status: "failed" }));
    const ids = new Set<string>();
    for (const claimed of ["succeeded", "failed", "pending", "whatever"]) {
      const event = await provider.verifyWebhook(notification("r1", claimed), signed());
      ids.add(event.providerEventId);
    }
    expect(ids.size, "the claim must not influence the id").toBe(1);
    expect([...ids][0]).toBe(ipaymoneyEventId("r1", "failed"));
  });

  it("does not depend on the delivery's bytes", async () => {
    /*
     * A retry that re-serialises the payload differently is the same fact. If
     * the id hashed the body, such a retry would look new and the deduplication
     * would not happen at all.
     */
    const provider = withLookup(() =>
      jsonResponse(200, { reference: "r1", status: "succeeded" }));

    const a = await provider.verifyWebhook(notification("r1", "succeeded"), signed());
    const reordered = Buffer.from(JSON.stringify({
      data: { status: "succeeded", reference: "r1", msisdn: "40410000001",
              external_reference: "order:x:charge", extra: "added by a proxy" },
    }), "utf8");
    const b = await provider.verifyWebhook(reordered, signed());

    expect(a.providerEventId).toBe(b.providerEventId);
  });
});

describe("what stays unsupported, and why", () => {
  const provider = new IPayMoneyProvider({ apiKey: "sk_x", environment: "sandbox" });

  it("refuses to refund, because iPayMoney documents no customer refund", async () => {
    await expect(
      provider.refund({
        providerRef: "r", amount: money(1n, "XOF"), reason: "x", idempotencyKey: "k",
      }),
    ).rejects.toThrow(ProviderNotConfiguredError);
  });

  it("says plainly that reversement is not a refund", async () => {
    const error = await provider
      .refund({ providerRef: "r", amount: money(1n, "XOF"), reason: "x", idempotencyKey: "k" })
      .catch((e: unknown) => e);
    // The single most dangerous misreading of this provider, refused in words.
    expect(String((error as Error).message)).toMatch(/reversement.*not a refund/i);
  });

  it("refuses to query a refund that has no API", async () => {
    await expect(provider.getRefund({ providerRefundRef: "r" }))
      .rejects.toThrow(ProviderNotConfiguredError);
  });

  it("declares no disbursement capability", () => {
    // createPayout/getPayout stay absent: the documented reversement is a
    // dashboard withdrawal of the merchant's own balance, not a payout API.
    expect("createPayout" in provider).toBe(false);
    expect("getPayout" in provider).toBe(false);
  });
});
