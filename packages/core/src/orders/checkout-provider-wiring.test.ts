import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { ProviderNotConfiguredError } from "../errors";
import { money } from "../money";
import { IPayMoneyProvider } from "../payments";
import type {
  ChargeInput, ChargeResult, ChargeStatus, HeadersLike, PaymentProvider, RefundInput,
  RefundResult, VerifiedEvent,
} from "../payments";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { createCheckout, initiatePayment } from "./index";

/**
 * What the real checkout path actually hands the provider.
 *
 * The Phase 3 sandbox report closed with a concrete blocker: `initiatePayment`
 * did not pass the buyer's phone or country, so the iPayMoney adapter refused
 * every charge — correctly, since it will not guess a payer's number. This file
 * is the proof that the path now carries what Afrinext genuinely knows, and the
 * proof that it still refuses rather than inventing what Afrinext does not.
 *
 * Two provider shapes are used, and the difference matters:
 *
 *   RecordingProvider   captures the `ChargeInput` the order domain built. It
 *                       accepts anything, so it can show what was passed even
 *                       in the cases a real adapter would reject.
 *
 *   IPayMoneyProvider   the real adapter over an INJECTED fetch. Nothing here
 *                       reaches iPayMoney. This is a LOCAL PROVIDER-TRANSPORT
 *                       TEST, not a sandbox test: no sandbox credentials exist,
 *                       and `ipaymoney.integration.test.ts` remains the only
 *                       place that talks to the real provider.
 */

let db: Database;
let counter = 0;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  await db.execute(sql`
    insert into commission_rules
      (id, transaction_type, rate_bps, currency, priority, effective_from)
    values (gen_random_uuid(), 'digital', 1800, 'XOF', 0, '2026-01-01T00:00:00Z')
  `);
});

// ---------------------------------------------------------------------------

/** A provider that accepts everything and remembers exactly what it was given. */
class RecordingProvider implements PaymentProvider {
  readonly id = "recording";
  readonly isConfigured = true;
  readonly statesChargeAmount = true;
  readonly seen: ChargeInput[] = [];

  createCharge(input: ChargeInput): Promise<ChargeResult> {
    this.seen.push(input);
    return Promise.resolve({
      providerRef: `rec-${this.seen.length}`, status: "pending" as const, raw: {},
    });
  }
  getCharge(providerRef: string): Promise<ChargeStatus> {
    return Promise.resolve({ providerRef, status: "pending" as const, raw: {} });
  }
  verifyWebhook(_b: Buffer, _h: HeadersLike): Promise<VerifiedEvent> {
    return Promise.reject(new Error("not used"));
  }
  refund(_i: RefundInput): Promise<RefundResult> {
    return Promise.reject(new Error("not used"));
  }
}

/** The real adapter, with a fetch that counts calls and never leaves the process. */
function ipaymoney(): { provider: IPayMoneyProvider; calls: () => number } {
  let calls = 0;
  const impl = ((_url: string, _init: unknown) => {
    calls += 1;
    return Promise.resolve(new Response(
      JSON.stringify({ reference: `ipay-${counter}`, status: "succeeded" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
  }) as unknown as typeof fetch;

  return {
    provider: new IPayMoneyProvider({
      baseUrl: "https://i-pay.money", apiKey: "sk_test", environment: "sandbox",
      fetchImpl: impl,
    }),
    calls: () => calls,
  };
}

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

async function makeBuyer(
  options: { phone?: string; countryCode?: string | null } = {},
): Promise<Actor> {
  const userId = await createTestUser(db, {
    locale: "fr",
    ...(options.phone !== undefined ? { phone: options.phone } : {}),
    ...(options.countryCode !== undefined ? { countryCode: options.countryCode } : {}),
  });
  await grantGlobal(userId, "member");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  return { userId };
}

/**
 * A published product whose SELLER is in a different country from the buyer.
 *
 * That difference is load-bearing: it is what makes "the buyer's country was
 * passed" a real assertion rather than a coincidence of both being "NE".
 */
async function listing(sellerCountry: string): Promise<{ storeSlug: string; productSlug: string }> {
  counter += 1;
  const sellerId = await createTestUser(db, { locale: "fr", countryCode: sellerCountry });
  await grantGlobal(sellerId, "member");
  await grantGlobal(sellerId, "seller");
  await acceptCurrentVersions(db, sellerId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  await acceptCurrentVersions(db, sellerId, ["seller_terms"], { locale: "fr" }, {
    method: "signup",
  });
  const seller = { userId: sellerId };

  const store = await createStore(db, seller, {
    name: `B ${counter}`, slug: `b-${counter}`, countryCode: sellerCountry,
  });
  await publishStore(db, seller, store.id);
  const product = await createProduct(db, seller, {
    storeId: store.id, title: `G ${counter}`, slug: `g-${counter}`, price: money(5000n, "XOF"),
  });
  await publishProduct(db, seller, product.id);
  return { storeSlug: store.slug, productSlug: product.slug };
}

async function checkoutFor(buyer: Actor, sellerCountry = "CI"): Promise<string> {
  const l = await listing(sellerCountry);
  const { order } = await createCheckout(db, buyer, {
    storeSlug: l.storeSlug, productSlug: l.productSlug, checkoutKey: `k-${counter}`,
  });
  return order.id;
}

async function paymentRow(orderId: string) {
  const rows = await db.execute<{ [k: string]: unknown; status: string }>(sql`
    select status from payments where order_id = ${orderId}::uuid
  `);
  return rows.rows;
}

async function orderStatus(orderId: string): Promise<string | undefined> {
  const rows = await db.execute<{ [k: string]: unknown; status: string }>(sql`
    select status from orders where id = ${orderId}::uuid
  `);
  return rows.rows[0]?.status;
}

// ---------------------------------------------------------------------------

describe("what the buyer's own record contributes to a charge", () => {
  it("passes the buyer's VERIFIED sign-in number as the payer", async () => {
    const buyer = await makeBuyer({ phone: "+22790123456" });
    const orderId = await checkoutFor(buyer);
    const provider = new RecordingProvider();

    await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" });

    expect(provider.seen).toHaveLength(1);
    expect(provider.seen[0]?.customer.phone).toBe("+22790123456");
  });

  it("passes the BUYER's country, never the seller's", async () => {
    /*
     * The seller is in Côte d'Ivoire and the buyer is in Niger. If the wiring
     * ever reached for the store's country — which is right there in the order
     * — this is the assertion that would catch it.
     */
    const buyer = await makeBuyer({ phone: "+22790123457", countryCode: "NE" });
    const orderId = await checkoutFor(buyer, "CI");
    const provider = new RecordingProvider();

    await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" });

    expect(provider.seen[0]?.metadata?.["country"]).toBe("NE");
    expect(provider.seen[0]?.metadata?.["buyerCountry"]).toBe("NE");
  });

  it("passes the channel the caller chose, and never invents one", async () => {
    const buyer = await makeBuyer({ phone: "+22790123458" });
    const provider = new RecordingProvider();

    const withCard = await checkoutFor(buyer);
    await initiatePayment(db, buyer, provider, { orderId: withCard, channel: "card" });
    expect(provider.seen[0]?.channel).toBe("card");

    const withNothing = await checkoutFor(buyer);
    await initiatePayment(db, buyer, provider, { orderId: withNothing });
    expect(
      provider.seen[1]?.channel,
      "no channel was chosen, so none is sent — iPayMoney documents no default",
    ).toBeUndefined();
  });

  it("sends NO customer name, because Afrinext does not have one", async () => {
    /*
     * `users.display_name` holds a synthetic address and Better Auth's `name`
     * holds the phone string. Both are placeholders written at signup. Passing
     * either would be inventing a value for a provider-required field, and
     * would additionally hand iPayMoney an internal hostname.
     */
    const buyer = await makeBuyer({ phone: "+22790123459" });
    const orderId = await checkoutFor(buyer);
    const provider = new RecordingProvider();

    await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" });

    const metadata = provider.seen[0]?.metadata ?? {};
    expect(metadata["customerName"]).toBeUndefined();
    expect(
      Object.values(metadata).join(" "),
      "nothing resembling the synthetic signup address is sent",
    ).not.toMatch(/phone\.afrinext\.local/);
  });

  it("omits the country entirely when the buyer has none, rather than guessing", async () => {
    const buyer = await makeBuyer({ phone: "+22790123460", countryCode: null });
    const orderId = await checkoutFor(buyer, "CI");
    const provider = new RecordingProvider();

    await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" });

    expect(provider.seen[0]?.metadata?.["country"]).toBeUndefined();
    expect(provider.seen[0]?.metadata?.["buyerCountry"]).toBeUndefined();
  });

  it("omits the phone when the account has no verified number", async () => {
    const buyer = await makeBuyer();
    const orderId = await checkoutFor(buyer);
    const provider = new RecordingProvider();

    await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" });

    expect(provider.seen[0]?.customer.phone).toBeUndefined();
    expect(provider.seen[0]?.customer.userId).toBe(buyer.userId);
  });
});

// ---------------------------------------------------------------------------

describe("the real adapter, reached through the real checkout path", () => {
  it("still refuses, and names customer_name as what is missing", async () => {
    /*
     * The honest end state of this milestone. Phone and country now arrive;
     * `customer_name` does not exist anywhere in Afrinext, so iPayMoney's
     * documented requirement is unmet and the adapter refuses.
     *
     * This test asserts the CURRENT truth. When a name becomes available it
     * will fail, and that failure is the signal that the last field landed.
     */
    const buyer = await makeBuyer({ phone: "+22790123461", countryCode: "NE" });
    const orderId = await checkoutFor(buyer);
    const { provider, calls } = ipaymoney();

    const error = await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderNotConfiguredError);
    expect((error as Error).message).toMatch(/customer_name/);
    expect((error as Error).message, "phone and country are no longer missing")
      .not.toMatch(/msisdn|metadata\.country/);
    expect(calls(), "no request is constructed when a required field is missing").toBe(0);
  });

  it("refuses without a channel, and constructs no request", async () => {
    const buyer = await makeBuyer({ phone: "+22790123462", countryCode: "NE" });
    const orderId = await checkoutFor(buyer);
    const { provider, calls } = ipaymoney();

    const error = await initiatePayment(db, buyer, provider, { orderId })
      .catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/payment type/);
    expect(calls()).toBe(0);
  });

  it("refuses without a phone, and constructs no request", async () => {
    const buyer = await makeBuyer({ countryCode: "NE" });
    const orderId = await checkoutFor(buyer);
    const { provider, calls } = ipaymoney();

    const error = await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" })
      .catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/msisdn/);
    expect(calls()).toBe(0);
  });

  it("refuses without a country, and constructs no request", async () => {
    const buyer = await makeBuyer({ phone: "+22790123463", countryCode: null });
    const orderId = await checkoutFor(buyer);
    const { provider, calls } = ipaymoney();

    const error = await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" })
      .catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/metadata\.country/);
    expect(calls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("a refusal is safe, and an unknown is not a refusal", () => {
  it("closes the payment and the order when the provider proves no charge exists", async () => {
    /*
     * Without this, `payments_one_live_per_order` turns a refusal into a dead
     * end: the row stays `initiated`, every later attempt returns that row
     * instead of calling the provider, and the buyer clicks pay forever.
     */
    const buyer = await makeBuyer({ phone: "+22790123464", countryCode: "NE" });
    const orderId = await checkoutFor(buyer);
    const { provider } = ipaymoney();

    await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" })
      .catch(() => undefined);

    const rows = await paymentRow(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status, "not left stuck at initiated").toBe("failed");
    expect(await orderStatus(orderId)).toBe("failed");
  });

  it("leaves an UNKNOWN outcome open rather than calling it a failure", async () => {
    /*
     * The Phase 3 rule, one layer up. A 5xx arrives after the request reached
     * iPayMoney, so the charge may exist under our idempotency key. Marking the
     * payment failed here would assert that no money moved — which is exactly
     * what the approved correction forbids.
     */
    const buyer = await makeBuyer({ phone: "+22790123465", countryCode: "NE" });
    const orderId = await checkoutFor(buyer);

    let attempted = 0;
    const impl = (() => {
      attempted += 1;
      return Promise.resolve(new Response("upstream boom", { status: 502 }));
    }) as unknown as typeof fetch;

    /*
     * A provider that gets past validation — the adapter needs a customer name
     * to build a request at all, so it is supplied here through metadata to
     * reach the transport. This proves the transport classification, not the
     * presence of a name in Afrinext.
     */
    const provider = new IPayMoneyProvider({
      baseUrl: "https://i-pay.money", apiKey: "sk_test", environment: "sandbox",
      fetchImpl: impl,
    });
    const named: PaymentProvider = {
      ...provider,
      id: provider.id,
      isConfigured: provider.isConfigured,
      statesChargeAmount: provider.statesChargeAmount,
      createCharge: (input: ChargeInput) =>
        provider.createCharge({
          ...input,
          metadata: { ...(input.metadata ?? {}), customerName: "Sandbox Buyer" },
        }),
      getCharge: (ref: string) => provider.getCharge(ref),
      verifyWebhook: (b: Buffer, h: HeadersLike) => provider.verifyWebhook(b, h),
      refund: (i: RefundInput) => provider.refund(i),
    };

    await initiatePayment(db, buyer, named, { orderId, channel: "mobile" })
      .catch(() => undefined);

    expect(attempted, "the request did reach the transport").toBe(1);
    const rows = await paymentRow(orderId);
    expect(rows[0]?.status, "unknown must never become failed").toBe("initiated");
    expect(await orderStatus(orderId), "the order is not closed on an unknown")
      .toBe("pending_payment");
  });

  it("keeps one live payment per order across a refusal and a retry", async () => {
    const buyer = await makeBuyer({ phone: "+22790123466", countryCode: "NE" });
    const orderId = await checkoutFor(buyer);
    const provider = new RecordingProvider();

    const first = await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" });
    const second = await initiatePayment(db, buyer, provider, { orderId, channel: "mobile" });

    expect(second.id, "the same charge, not a second one").toBe(first.id);
    expect(provider.seen, "the provider was called exactly once").toHaveLength(1);
    expect(await paymentRow(orderId)).toHaveLength(1);
  });
});
