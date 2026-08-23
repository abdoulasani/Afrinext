import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { commerceIsClean, reconcileCommerce } from "../ledger";
import { money } from "../money";
import { applyProviderEvent } from "../orders";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { ipaymoneyEventId, IPayMoneyProvider } from "./ipaymoney";
import type { HeadersLike } from "./provider";

/**
 * The derived event id, against a real database and the real domain.
 *
 * `ipaymoney.test.ts` proves the id is stable, distinct per payment, and not
 * influenced by what a notification claims. Those are properties of a string.
 * This file proves the property that actually matters to a buyer: **five
 * deliveries of one event grant one entitlement**, through `applyProviderEvent`
 * and the `UNIQUE (provider, provider_event_id)` index it relies on.
 *
 * That index is Afrinext's replay defence, and iPayMoney is the first provider
 * that does not supply an id for it. If the derivation were wrong — keyed on
 * something that varies between retries — this is where it would show, as a
 * second entitlement rather than as a failing assertion about a string.
 *
 * The HTTP layer is injected; nothing here reaches iPayMoney. The payment row
 * is inserted directly rather than through `initiatePayment`, because
 * `initiatePayment` does not yet pass the buyer's phone or country to the
 * provider and iPayMoney refuses a charge without them — a real integration gap
 * reported in the milestone report, and not one this test should paper over.
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

const SECRET = "sk_test_webhook_secret";

/** A provider whose payment lookups answer with a status the test decides. */
function providerAnswering(status: string, reference: string): IPayMoneyProvider {
  const impl = (() =>
    Promise.resolve(new Response(
      JSON.stringify({ reference, status, external_reference: "order", msisdn: "40410000001" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ))) as unknown as typeof fetch;

  return new IPayMoneyProvider({
    baseUrl: "https://i-pay.money",
    apiKey: "sk_x",
    environment: "sandbox",
    webhookSecret: SECRET,
    fetchImpl: impl,
  });
}

const signed: HeadersLike = {
  get: (name: string) => (name.toLowerCase() === "secret-hash" ? SECRET : null),
};

function notification(reference: string, claimedStatus: string): Buffer {
  return Buffer.from(JSON.stringify({
    data: { external_reference: "order", reference, status: claimedStatus, msisdn: "40410000001" },
  }), "utf8");
}

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

interface Sale {
  orderId: string;
  paymentId: string;
  reference: string;
  buyer: Actor;
}

/**
 * A real order with a real product, and a payment attributed to iPayMoney.
 *
 * Everything except the provider call is the production path: a published
 * store, a published product, an order priced by the server, and a pending
 * payment row that a webhook can find by `(provider, provider_ref)`.
 */
async function pendingSale(): Promise<Sale> {
  counter += 1;
  const sellerId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(sellerId, "member");
  await grantGlobal(sellerId, "seller");
  await acceptCurrentVersions(db, sellerId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  await acceptCurrentVersions(db, sellerId, ["seller_terms"], { locale: "fr" }, {
    method: "signup",
  });
  const seller = { userId: sellerId };

  const store = await createStore(db, seller, { storeType: "digital_product", name: `IP ${counter}`, slug: `ip-${counter}` });
  await publishStore(db, seller, store.id);
  const product = await createProduct(db, seller, {
    storeId: store.id, title: `P ${counter}`, slug: `ipp-${counter}`, price: money(5000n, "XOF"),
  });
  await publishProduct(db, seller, product.id);

  const buyerId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(buyerId, "member");
  await acceptCurrentVersions(db, buyerId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });

  const orderId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const reference = `ipay-ref-${counter}`;

  await db.execute(sql`
    insert into orders (id, buyer_user_id, store_id, checkout_key, status, total_minor,
                        currency, expires_at)
    values (${orderId}, ${buyerId}, ${store.id}, ${"k-" + counter}, 'pending_payment', 5000,
            'XOF', now() + interval '1 hour')
  `);
  await db.execute(sql`
    insert into order_items (id, order_id, product_id, store_id, title_snapshot,
                             unit_price_minor, currency, quantity, line_total_minor)
    values (gen_random_uuid(), ${orderId}, ${product.id}, ${store.id}, ${product.title},
            5000, 'XOF', 1, 5000)
  `);
  await db.execute(sql`
    insert into payments (id, order_id, provider, provider_ref, status, amount_minor,
                          currency, idempotency_key)
    values (${paymentId}, ${orderId}, 'ipaymoney', ${reference}, 'pending', 5000, 'XOF',
            ${"order:" + orderId + ":charge"})
  `);

  return { orderId, paymentId, reference, buyer: { userId: buyerId } };
}

async function stateOf(orderId: string) {
  const o = await db.execute<{ [k: string]: unknown; status: string }>(sql`
    select status from orders where id = ${orderId}::uuid`);
  const e = await db.execute<{ [k: string]: unknown; n: string }>(sql`
    select count(*) as n from entitlements where order_id = ${orderId}::uuid`);
  const ev = await db.execute<{ [k: string]: unknown; n: string }>(sql`
    select count(*) as n from payment_events where provider = 'ipaymoney'`);
  return {
    order: o.rows[0]?.status,
    entitlements: Number(e.rows[0]?.n),
    events: Number(ev.rows[0]?.n),
  };
}

// ---------------------------------------------------------------------------

describe("iPayMoney replay, against the real domain", () => {
  it("grants ONE entitlement for five deliveries of one event", async () => {
    /*
     * The documented behaviour, not a hypothetical: iPayMoney retries five
     * times on any non-2xx. Without a stable derived id every retry would be a
     * fresh event, and `applyProviderEvent` would apply the confirmation five
     * times.
     */
    const sale = await pendingSale();
    const provider = providerAnswering("succeeded", sale.reference);
    const body = notification(sale.reference, "succeeded");

    const outcomes = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(await applyProviderEvent(db, provider, body, signed));
    }

    expect(outcomes[0]?.outcome).toBe("applied");
    // Every later delivery is recognised as the same fact.
    expect(outcomes.slice(1).every((o) => o.outcome === "ignored")).toBe(true);

    const state = await stateOf(sale.orderId);
    expect(state.order).toBe("paid");
    expect(state.entitlements, "one buyer, one product, one grant").toBe(1);
    expect(state.events, "one event row, under the replay index").toBe(1);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("stores the id the derivation says it should", async () => {
    const sale = await pendingSale();
    const provider = providerAnswering("succeeded", sale.reference);
    await applyProviderEvent(db, provider, notification(sale.reference, "succeeded"), signed);

    const rows = await db.execute<{ [k: string]: unknown; provider_event_id: string }>(sql`
      select provider_event_id from payment_events where provider = 'ipaymoney'
    `);
    expect(rows.rows[0]?.provider_event_id)
      .toBe(ipaymoneyEventId(sale.reference, "succeeded"));
  });

  it("does not let two payments collide, however similar", async () => {
    const a = await pendingSale();
    const b = await pendingSale();

    await applyProviderEvent(
      db, providerAnswering("succeeded", a.reference),
      notification(a.reference, "succeeded"), signed,
    );
    await applyProviderEvent(
      db, providerAnswering("succeeded", b.reference),
      notification(b.reference, "succeeded"), signed,
    );

    expect((await stateOf(a.orderId)).entitlements).toBe(1);
    expect((await stateOf(b.orderId)).entitlements).toBe(1);
    const events = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(distinct provider_event_id) as n from payment_events where provider = 'ipaymoney'
    `);
    expect(Number(events.rows[0]?.n), "two payments, two distinct ids").toBe(2);
  });

  it("a forged success cannot confirm a payment the provider says failed", async () => {
    /*
     * The attack the documented shared-secret scheme would otherwise permit,
     * carried all the way through the domain. The notification claims success;
     * iPayMoney, asked directly, says the payment failed. Nothing is granted.
     */
    const sale = await pendingSale();
    const provider = providerAnswering("failed", sale.reference);

    const applied = await applyProviderEvent(
      db, provider, notification(sale.reference, "succeeded"), signed,
    );

    expect(applied.orderStatus).not.toBe("paid");
    const state = await stateOf(sale.orderId);
    expect(state.order).toBe("failed");
    expect(state.entitlements, "a forged claim grants nothing").toBe(0);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("refuses a notification whose secret is wrong, before reaching the domain", async () => {
    const sale = await pendingSale();
    const provider = providerAnswering("succeeded", sale.reference);
    const wrong: HeadersLike = { get: () => "not-the-secret" };

    await expect(
      applyProviderEvent(db, provider, notification(sale.reference, "succeeded"), wrong),
    ).rejects.toThrow();

    const state = await stateOf(sale.orderId);
    expect(state.order).toBe("pending_payment");
    expect(state.entitlements).toBe(0);
    expect(state.events, "nothing is recorded for an unauthenticated notification").toBe(0);
  });
});
