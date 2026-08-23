import { sql } from "drizzle-orm";
import { LAUNCH_PAYMENT_CHANNEL } from "../payments";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { ConsentRequiredError, PermissionDeniedError } from "../errors";
import { money } from "../money";
import { MockPaymentProvider } from "../payments";
import { createTestUser, ensureReferenceData, giveProductAFile, resetData, testDb } from "../test/harness";
import {
  AlreadyOwnedError, applyProviderEvent, canTransitionOrder, canTransitionPayment,
  CheckoutConflictError, createCheckout, expireLapsedOrders, findOwnOrder,
  initiatePayment, InvalidTransitionError, isTerminalOrderState, listOwnEntitlements,
  listOwnOrders, ORDER_STATES, OrderNotFoundError, OrderNotPayableError,
  orderStateForPayment, PAYMENT_STATES, ProductNotPurchasableError, WebhookRejectedError,
} from "./index";

/**
 * Checkout, the payment state machine, and every way someone might try to get
 * a product without paying for it.
 *
 * The buyer here is a real member with real consent and a real published
 * product, because the interesting failures are the ones that survive a
 * correctly set up world.
 */

let db: Database;
let provider: MockPaymentProvider;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  provider = new MockPaymentProvider();
  /*
   * The commission rule for digital sales.
   *
   * Production seeds this row; the test harness truncates `commission_rules`
   * so that a commissions test can prove the platform refuses to settle a sale
   * with no rule in force. Rather than weaken that test by restoring the seed,
   * this file states the rule it assumes — which is the same 18% the seed
   * writes.
   */
  await db.execute(sql`
    insert into commission_rules
      (id, transaction_type, rate_bps, currency, priority, effective_from)
    values (gen_random_uuid(), 'digital', 1800, 'XOF', 0, '2026-01-01T00:00:00Z')
  `);
});

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

/** A member who has accepted the general terms — the state signup leaves. */
async function makeBuyer(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  return { userId };
}

async function makeSeller(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "seller");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  await acceptCurrentVersions(db, userId, ["seller_terms"], { locale: "fr" }, { method: "signup" });
  return { userId };
}

let slugCounter = 0;

/** A published product in a published store, priced in XOF — zero decimals. */
async function publishedProduct(options: { priceMinor?: bigint; title?: string } = {}): Promise<{
  seller: Actor;
  storeSlug: string;
  productSlug: string;
  productId: string;
  priceMinor: bigint;
}> {
  slugCounter += 1;
  const seller = await makeSeller();
  const store = await createStore(db, seller, { storeType: "digital_product",
    name: `Boutique ${slugCounter}`,
    slug: `boutique-${slugCounter}`,
  });
  await publishStore(db, seller, store.id);
  const priceMinor = options.priceMinor ?? 5000n;
  const product = await createProduct(db, seller, {
    storeId: store.id,
    title: options.title ?? `Guide ${slugCounter}`,
    slug: `guide-${slugCounter}`,
    price: money(priceMinor, "XOF"),
  });
  await giveProductAFile(db, product.id);
  await publishProduct(db, seller, product.id);
  return {
    seller,
    storeSlug: store.slug,
    productSlug: product.slug,
    productId: product.id,
    priceMinor,
  };
}

/** Checkout plus initiation: the state a buyer is in when they go off to pay. */
async function pendingOrder(overrides: { buyer?: Actor; priceMinor?: bigint; title?: string } = {}) {
  const listing = await publishedProduct({
    ...(overrides.priceMinor !== undefined ? { priceMinor: overrides.priceMinor } : {}),
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
  });
  const buyer = overrides.buyer ?? (await makeBuyer());
  const { order } = await createCheckout(db, buyer, {
    storeSlug: listing.storeSlug,
    productSlug: listing.productSlug,
    checkoutKey: `key-${order_counter()}`,
  });
  const payment = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });
  return { ...listing, buyer, order, payment };
}

let keyCounter = 0;
function order_counter(): number {
  keyCounter += 1;
  return keyCounter;
}

/**
 * Asserts the CLASS of the rejection, not the wording of its message.
 *
 * A message regex passes when an unrelated failure happens to contain the same
 * words; the class is what the API layer branches on, so it is what these tests
 * pin down.
 */
async function rejectsWith(
  promise: Promise<unknown>,
  expected: new (...args: never[]) => Error,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(expected);
}

function statusOfOrder(orderId: string): Promise<string | undefined> {
  return db
    .execute<{ status: string }>(sql`select status from orders where id = ${orderId}::uuid`)
    .then((r) => r.rows[0]?.status);
}

function statusOfPayment(paymentId: string): Promise<string | undefined> {
  return db
    .execute<{ status: string }>(sql`select status from payments where id = ${paymentId}::uuid`)
    .then((r) => r.rows[0]?.status);
}

// ---------------------------------------------------------------------------

describe("the state machines are declared, not improvised", () => {
  it("lets an order leave pending_payment exactly once", () => {
    expect(canTransitionOrder("pending_payment", "paid")).toBe(true);
    expect(canTransitionOrder("pending_payment", "cancelled")).toBe(true);
    expect(canTransitionOrder("pending_payment", "expired")).toBe(true);
    expect(canTransitionOrder("pending_payment", "failed")).toBe(true);

    /*
     * Every state except `expired` is terminal. A paid order does not become
     * cancelled, and a failed one does not quietly become paid.
     *
     * `expired` is the one exception, and it is a policy decision rather than a
     * looseness: a provider can confirm a charge after we stopped waiting, and
     * money that has actually moved cannot be answered with silence. It has two
     * remaining ends — `paid` if fulfilling is still safe, `refund_due` if it is
     * not — and both are proved in `late-payment.test.ts`.
     */
    for (const from of ORDER_STATES.filter((s) => s !== "pending_payment" && s !== "expired")) {
      expect(isTerminalOrderState(from), `${from} must be terminal`).toBe(true);
      for (const to of ORDER_STATES) {
        expect(canTransitionOrder(from, to), `${from} → ${to}`).toBe(false);
      }
    }

    expect(isTerminalOrderState("expired")).toBe(false);
    expect(canTransitionOrder("expired", "paid")).toBe(true);
    expect(canTransitionOrder("expired", "refund_due")).toBe(true);
    for (const to of ORDER_STATES.filter((t) => t !== "paid" && t !== "refund_due")) {
      expect(canTransitionOrder("expired", to), `expired → ${to}`).toBe(false);
    }
  });

  it("refuses a payment transition that skips or reverses", () => {
    expect(canTransitionPayment("initiated", "pending")).toBe(true);
    expect(canTransitionPayment("pending", "succeeded")).toBe(true);
    expect(canTransitionPayment("succeeded", "failed")).toBe(false);
    expect(canTransitionPayment("failed", "succeeded")).toBe(false);
    expect(canTransitionPayment("cancelled", "succeeded")).toBe(false);
    for (const to of PAYMENT_STATES) {
      expect(canTransitionPayment("succeeded", to), `succeeded → ${to}`).toBe(false);
    }
  });

  it("maps a payment state to an order state in one place", () => {
    expect(orderStateForPayment("succeeded")).toBe("paid");
    expect(orderStateForPayment("failed")).toBe("failed");
    expect(orderStateForPayment("cancelled")).toBe("cancelled");
    expect(orderStateForPayment("expired")).toBe("expired");
    // In flight is not an order state: the order stays pending_payment.
    expect(orderStateForPayment("pending")).toBeUndefined();
    expect(orderStateForPayment("initiated")).toBeUndefined();
  });
});

describe("checkout prices the order, and the client does not", () => {
  it("reads the price from the product and computes the total itself", async () => {
    const listing = await publishedProduct({ priceMinor: 7500n });
    const buyer = await makeBuyer();

    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug,
      productSlug: listing.productSlug,
      checkoutKey: "k1",
    });

    expect(order.total.amountMinor).toBe(7500n);
    expect(order.total.currency).toBe("XOF");
    expect(order.status).toBe("pending_payment");
    // Snapshotted, so a later price change cannot restate this sale.
    expect(order.items[0]?.unitPrice.amountMinor).toBe(7500n);
  });

  it("keeps the agreed price when the seller changes it afterwards", async () => {
    const listing = await publishedProduct({ priceMinor: 5000n });
    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "k2",
    });

    await db.execute(sql`
      update products set price_minor = 99000 where id = ${listing.productId}::uuid
    `);

    const reread = await findOwnOrder(db, buyer, order.id);
    expect(reread.total.amountMinor).toBe(5000n);
    expect(reread.items[0]?.unitPrice.amountMinor).toBe(5000n);
  });

  it("computes a multi-quantity total in minor units, never by floating point", async () => {
    const listing = await publishedProduct({ priceMinor: 3333n });
    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug,
      checkoutKey: "k3", quantity: 3,
    });
    expect(order.total.amountMinor).toBe(9999n);
  });

  it("refuses a draft product, an unpublished store and a product that does not exist", async () => {
    const buyer = await makeBuyer();
    const seller = await makeSeller();
    const store = await createStore(db, seller, { storeType: "digital_product", name: "Cachée", slug: "cachee" });
    const draft = await createProduct(db, seller, {
      storeId: store.id, title: "Brouillon", slug: "brouillon", price: money(1000n, "XOF"),
    });

    // A draft product in a published store.
    await publishStore(db, seller, store.id);
    await rejectsWith(
      createCheckout(db, buyer, { storeSlug: "cachee", productSlug: "brouillon", checkoutKey: "a" }),
      ProductNotPurchasableError,
    );

    // A published product whose store is suspended. The product is perfectly
    // fine; it is simply not reachable, so it is not buyable either.
    await giveProductAFile(db, draft.id);
    await publishProduct(db, seller, draft.id);
    await db.execute(sql`update stores set status = 'suspended' where id = ${store.id}::uuid`);
    await rejectsWith(
      createCheckout(db, buyer, { storeSlug: "cachee", productSlug: "brouillon", checkoutKey: "b" }),
      ProductNotPurchasableError,
    );

    await rejectsWith(
      createCheckout(db, buyer, { storeSlug: "cachee", productSlug: "nexiste-pas", checkoutKey: "c" }),
      ProductNotPurchasableError,
    );
  });

  it("refuses a buyer with no order.create permission", async () => {
    const listing = await publishedProduct();
    const userId = await createTestUser(db, { locale: "fr" });
    await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
      method: "signup",
    });
    // No `member` role: consent is not capability.
    await rejectsWith(
      createCheckout(db, { userId }, {
        storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "d",
      }),
      PermissionDeniedError,
    );
  });

  it("refuses a buyer whose account has not accepted the general terms", async () => {
    /*
     * Belt and braces, and worth having.
     *
     * A `pending_consent` account resolves to NO actor, so in the running
     * system this call cannot normally be reached. This test constructs the
     * actor directly to reach it anyway — because "unreachable today" is a
     * property of `resolveActor`, and a checkout that relied on that would be
     * one refactor away from selling to an unconsented account.
     */
    const listing = await publishedProduct();
    const userId = await createTestUser(db, { locale: "fr" });
    await grantGlobal(userId, "member");
    await db.execute(sql`update users set status = 'pending_consent' where id = ${userId}::uuid`);

    await rejectsWith(
      createCheckout(db, { userId }, {
        storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "unconsented",
      }),
      ConsentRequiredError,
    );

    const count = await db.execute<{ n: string }>(sql`select count(*) as n from orders`);
    expect(Number(count.rows[0]?.n)).toBe(0);
  });

  it("refuses a seller buying from their own store", async () => {
    const listing = await publishedProduct();
    await rejectsWith(
      createCheckout(db, listing.seller, {
        storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "e",
      }),
      ProductNotPurchasableError,
    );
  });
});

describe("checkout is idempotent", () => {
  it("returns the same order for a repeated key, and creates only one", async () => {
    const listing = await publishedProduct();
    const buyer = await makeBuyer();
    const input = {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "same",
    };

    const first = await createCheckout(db, buyer, input);
    const second = await createCheckout(db, buyer, input);

    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    const count = await db.execute<{ n: string }>(sql`
      select count(*) as n from orders where buyer_user_id = ${buyer.userId}::uuid
    `);
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  it("survives concurrent submissions of the same intent", async () => {
    const listing = await publishedProduct();
    const buyer = await makeBuyer();
    const input = {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "race",
    };

    const results = await Promise.all([
      createCheckout(db, buyer, input),
      createCheckout(db, buyer, input),
      createCheckout(db, buyer, input),
    ]);

    const ids = new Set(results.map((r) => r.order.id));
    expect(ids.size, "three concurrent submits, one order").toBe(1);

    const items = await db.execute<{ n: string }>(sql`
      select count(*) as n from order_items where order_id = ${[...ids][0]}::uuid
    `);
    expect(Number(items.rows[0]?.n), "and one line").toBe(1);
  });

  it("refuses to reuse one key for a different product", async () => {
    const first = await publishedProduct();
    const second = await publishedProduct();
    const buyer = await makeBuyer();

    await createCheckout(db, buyer, {
      storeSlug: first.storeSlug, productSlug: first.productSlug, checkoutKey: "reused",
    });
    await rejectsWith(
      createCheckout(db, buyer, {
        storeSlug: second.storeSlug, productSlug: second.productSlug, checkoutKey: "reused",
      }),
      CheckoutConflictError,
    );
  });

  it("scopes the key to the buyer, so two people may use the same string", async () => {
    const listing = await publishedProduct();
    const one = await makeBuyer();
    const two = await makeBuyer();
    const input = {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "checkout",
    };
    const a = await createCheckout(db, one, input);
    const b = await createCheckout(db, two, input);
    expect(a.order.id).not.toBe(b.order.id);
  });
});

describe("payment initiation", () => {
  it("hands the provider the order's amount, and records pending", async () => {
    const { order, payment } = await pendingOrder({ priceMinor: 4200n });

    expect(payment.amount.amountMinor).toBe(4200n);
    expect(payment.amount.currency).toBe("XOF");
    // Not `succeeded`: nothing is confirmed until a signed event says so.
    expect(payment.status).toBe("pending");
    expect(await statusOfOrder(order.id)).toBe("pending_payment");
  });

  it("returns the live attempt rather than starting a second charge", async () => {
    const { buyer, order, payment } = await pendingOrder();
    const again = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });
    expect(again.id).toBe(payment.id);

    const count = await db.execute<{ n: string }>(sql`
      select count(*) as n from payments where order_id = ${order.id}::uuid
    `);
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  it("refuses to pay someone else's order", async () => {
    const { order } = await pendingOrder();
    const stranger = await makeBuyer();
    await rejectsWith(
      initiatePayment(db, stranger, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL }),
      OrderNotFoundError,
    );
  });

  it("refuses an expired checkout, and marks it expired", async () => {
    const { buyer, order } = await pendingOrder();
    await db.execute(sql`
      update orders set expires_at = now() - interval '1 minute',
                        status = 'pending_payment'
       where id = ${order.id}::uuid
    `);
    // Clear the live attempt so initiation reaches the expiry check.
    await db.execute(sql`delete from payments where order_id = ${order.id}::uuid`);

    await rejectsWith(
      initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL }),
      OrderNotPayableError,
    );
    expect(await statusOfOrder(order.id)).toBe("expired");
  });

  it("closes the order when the provider refuses at initiation", async () => {
    // The mock fails any charge whose reference carries the marker; the
    // reference is derived from the order, so this is arranged by the title.
    const listing = await publishedProduct();
    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "fails",
    });
    const failing = new MockPaymentProvider({ failureMarker: "order-" });

    const payment = await initiatePayment(db, buyer, failing, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });
    expect(payment.status).toBe("failed");
    expect(await statusOfOrder(order.id)).toBe("failed");
  });

  it("refuses to pay an order that is already paid", async () => {
    const { buyer, order, payment } = await pendingOrder();
    const event = provider.event({
      id: "evt-paid-1", providerRef: payment.providerRef as string, status: "succeeded",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    await rejectsWith(
      initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL }),
      OrderNotPayableError,
    );
  });
});

describe("a confirmation is believed only after it is verified", () => {
  it("marks the order paid and grants the entitlement", async () => {
    const { buyer, order, payment, productId, priceMinor } = await pendingOrder();

    const event = provider.event({
      id: "evt-1", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    const applied = await applyProviderEvent(db, provider, event.body, event.headers);

    expect(applied.outcome).toBe("applied");
    expect(await statusOfOrder(order.id)).toBe("paid");
    expect(await statusOfPayment(payment.id)).toBe("succeeded");

    const owned = await listOwnEntitlements(db, buyer);
    expect(owned.map((e) => e.productId)).toEqual([productId]);
  });

  it("freezes the commission split, and the split re-sums to the gross", async () => {
    const { order, payment, priceMinor } = await pendingOrder({ priceMinor: 10000n });
    const event = provider.event({
      id: "evt-2", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    const lines = await db.execute<{ key: string; amount_minor: string }>(sql`
      select l.key, l.amount_minor
        from fee_lines l join fee_schedules s on s.id = l.schedule_id
       where s.subject_type = 'order' and s.subject_id = ${order.id}::uuid
       order by l.key
    `);
    const byKey = Object.fromEntries(lines.rows.map((r) => [r.key, BigInt(r.amount_minor)]));
    // 18% platform commission on 10 000 XOF, seller takes the residual.
    expect(byKey["platform"]).toBe(1800n);
    expect(byKey["seller"]).toBe(8200n);
    expect((byKey["platform"] as bigint) + (byKey["seller"] as bigint)).toBe(10000n);
  });

  it("posts NOTHING to the ledger — confirmation is not settlement", async () => {
    const { payment, priceMinor } = await pendingOrder();
    const event = provider.event({
      id: "evt-3", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    /*
     * The boundary, asserted rather than described.
     *
     * A confirmed payment records that a provider says it captured funds. It
     * does not move value between ledger accounts and it does not create a
     * seller's claim on money — that is settlement, it needs a real provider
     * settlement event and payout rails, and it is not built. The ledger is
     * append-only, so a posting made on a simulated capture could never be
     * removed; this test is what keeps one from being added by accident.
     */
    const entries = await db.execute<{ n: string }>(sql`select count(*) as n from ledger_entries`);
    expect(Number(entries.rows[0]?.n), "no ledger entries").toBe(0);
    const balances = await db.execute<{ n: string }>(sql`select count(*) as n from account_balances`);
    expect(Number(balances.rows[0]?.n), "no balances").toBe(0);
  });

  it("records a failure as failed, and grants nothing", async () => {
    const { buyer, order, payment } = await pendingOrder();
    const event = provider.event({
      id: "evt-4", providerRef: payment.providerRef as string, status: "failed",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    expect(await statusOfOrder(order.id)).toBe("failed");
    expect(await listOwnEntitlements(db, buyer)).toEqual([]);
  });

  it("records a cancellation as cancelled, and grants nothing", async () => {
    const { buyer, order, payment } = await pendingOrder();
    const event = provider.event({
      id: "evt-5", providerRef: payment.providerRef as string, status: "cancelled",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    expect(await statusOfOrder(order.id)).toBe("cancelled");
    expect(await listOwnEntitlements(db, buyer)).toEqual([]);
  });
});

describe("the trust boundary refuses what it should", () => {
  it("refuses an unsigned event", async () => {
    const { payment } = await pendingOrder();
    const event = provider.event({
      id: "evt-6", providerRef: payment.providerRef as string, status: "succeeded",
    });
    const noSignature = { get: () => null };
    await rejectsWith(
      applyProviderEvent(db, provider, event.body, noSignature),
      WebhookRejectedError,
    );
    expect(await statusOfPayment(payment.id)).toBe("pending");
  });

  it("refuses a forged signature", async () => {
    const { order, payment } = await pendingOrder();
    const event = provider.event({
      id: "evt-7", providerRef: payment.providerRef as string, status: "succeeded",
      signWith: "0".repeat(64),
    });
    await rejectsWith(
      applyProviderEvent(db, provider, event.body, event.headers),
      WebhookRejectedError,
    );
    expect(await statusOfOrder(order.id)).toBe("pending_payment");
  });

  it("refuses a correctly signed event whose body was altered afterwards", async () => {
    const { payment, priceMinor } = await pendingOrder();
    const event = provider.event({
      id: "evt-8", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    // Same signature, different bytes: the signature is over the raw body, so
    // this is the tamper case a parse-then-verify implementation would miss.
    const tampered = Buffer.from(
      event.body.toString("utf8").replace(String(priceMinor), "1"),
      "utf8",
    );
    await rejectsWith(
      applyProviderEvent(db, provider, tampered, event.headers),
      WebhookRejectedError,
    );
    expect(await statusOfPayment(payment.id)).toBe("pending");
  });

  it("refuses an amount that does not match, and keeps the evidence", async () => {
    const { order, payment, priceMinor } = await pendingOrder({ priceMinor: 5000n });
    const event = provider.event({
      id: "evt-9", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor - 1n, currency: "XOF",
    });
    await rejectsWith(
      applyProviderEvent(db, provider, event.body, event.headers),
      WebhookRejectedError,
    );

    expect(await statusOfOrder(order.id)).toBe("pending_payment");
    const events = await db.execute<{ outcome: string; reason: string }>(sql`
      select outcome, reason from payment_events where provider_event_id = 'evt-9'
    `);
    expect(events.rows[0]?.outcome).toBe("rejected");
    expect(events.rows[0]?.reason).toContain("amount mismatch");
  });

  it("refuses a currency that does not match", async () => {
    const { order, payment, priceMinor } = await pendingOrder();
    const event = provider.event({
      id: "evt-10", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "EUR",
    });
    await rejectsWith(
      applyProviderEvent(db, provider, event.body, event.headers),
      WebhookRejectedError,
    );
    expect(await statusOfOrder(order.id)).toBe("pending_payment");
  });

  it("refuses an event for a charge nobody here created", async () => {
    await pendingOrder();
    const event = provider.event({
      id: "evt-11", providerRef: "mockchg_99999999", status: "succeeded",
    });
    await rejectsWith(
      applyProviderEvent(db, provider, event.body, event.headers),
      WebhookRejectedError,
    );
  });

  it("cannot be used to pay one order with another order's charge", async () => {
    const first = await pendingOrder();
    const second = await pendingOrder();

    // A signed, genuine event for the FIRST charge. It moves the first order
    // and cannot touch the second.
    const event = provider.event({
      id: "evt-12", providerRef: first.payment.providerRef as string, status: "succeeded",
      amountMinor: first.priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    expect(await statusOfOrder(first.order.id)).toBe("paid");
    expect(await statusOfOrder(second.order.id)).toBe("pending_payment");
  });

  it("refuses a transition that is not legal from the payment's real state", async () => {
    const { payment } = await pendingOrder();
    const cancel = provider.event({
      id: "evt-13", providerRef: payment.providerRef as string, status: "cancelled",
    });
    await applyProviderEvent(db, provider, cancel.body, cancel.headers);

    // The provider now claims it succeeded after all. It did not, and a
    // cancelled charge has nowhere to go.
    const late = provider.event({
      id: "evt-14", providerRef: payment.providerRef as string, status: "succeeded",
    });
    const result = await applyProviderEvent(db, provider, late.body, late.headers);
    expect(result.outcome).toBe("ignored");
    expect(await statusOfPayment(payment.id)).toBe("cancelled");
  });
});

describe("repeated and concurrent confirmation", () => {
  it("applies a replayed event exactly once", async () => {
    const { buyer, order, payment, priceMinor } = await pendingOrder();
    const event = provider.event({
      id: "evt-replay", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });

    const first = await applyProviderEvent(db, provider, event.body, event.headers);
    const second = await applyProviderEvent(db, provider, event.body, event.headers);
    const third = await applyProviderEvent(db, provider, event.body, event.headers);

    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("ignored");
    expect(third.outcome).toBe("ignored");

    expect(await statusOfOrder(order.id)).toBe("paid");
    expect((await listOwnEntitlements(db, buyer)).length, "one grant").toBe(1);

    const schedules = await db.execute<{ n: string }>(sql`
      select count(*) as n from fee_schedules
       where subject_type = 'order' and subject_id = ${order.id}::uuid
    `);
    expect(Number(schedules.rows[0]?.n), "one frozen schedule").toBe(1);
  });

  it("treats a DIFFERENT event repeating a settled outcome as stale", async () => {
    const { order, payment, priceMinor } = await pendingOrder();
    const first = provider.event({
      id: "evt-a", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, first.body, first.headers);

    // Same outcome, new event id — a provider retrying with a fresh envelope.
    const again = provider.event({
      id: "evt-b", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    const result = await applyProviderEvent(db, provider, again.body, again.headers);

    expect(result.outcome).toBe("ignored");
    expect(await statusOfOrder(order.id)).toBe("paid");
    const grants = await db.execute<{ n: string }>(sql`select count(*) as n from entitlements`);
    expect(Number(grants.rows[0]?.n)).toBe(1);
  });

  it("survives concurrent deliveries of the same event", async () => {
    const { buyer, order, payment, priceMinor } = await pendingOrder();
    const event = provider.event({
      id: "evt-concurrent", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        applyProviderEvent(db, provider, event.body, event.headers),
      ),
    );
    const applied = settled.filter(
      (r) => r.status === "fulfilled" && r.value.outcome === "applied",
    );
    expect(applied.length, "exactly one delivery applies").toBe(1);

    expect(await statusOfOrder(order.id)).toBe("paid");
    expect((await listOwnEntitlements(db, buyer)).length).toBe(1);

    const events = await db.execute<{ n: string }>(sql`
      select count(*) as n from payment_events where provider_event_id = 'evt-concurrent'
    `);
    expect(Number(events.rows[0]?.n), "one row for one event id").toBe(1);
  });

  it("survives concurrent DIFFERENT events racing for the same charge", async () => {
    const { order, payment, priceMinor } = await pendingOrder();
    const success = provider.event({
      id: "evt-race-ok", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    const failure = provider.event({
      id: "evt-race-no", providerRef: payment.providerRef as string, status: "failed",
    });

    await Promise.allSettled([
      applyProviderEvent(db, provider, success.body, success.headers),
      applyProviderEvent(db, provider, failure.body, failure.headers),
    ]);

    // Whichever won, the order has ONE outcome and the entitlement matches it.
    const status = await statusOfOrder(order.id);
    expect(["paid", "failed"]).toContain(status);
    const grants = await db.execute<{ n: string }>(sql`select count(*) as n from entitlements`);
    expect(Number(grants.rows[0]?.n)).toBe(status === "paid" ? 1 : 0);
  });

  it("cannot grant twice when two orders for one product are confirmed at once", async () => {
    /*
     * A buyer CAN open two orders for the same product — the ownership check
     * at checkout looks at entitlements, and neither order has granted one yet.
     * Confirming both is therefore reachable, and it is the case the unique
     * index on (user_id, product_id) exists for.
     */
    const listing = await publishedProduct();
    const buyer = await makeBuyer();

    const first = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "twice-a",
    });
    const second = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "twice-b",
    });
    expect(first.order.id).not.toBe(second.order.id);

    const payOne = await initiatePayment(db, buyer, provider, { orderId: first.order.id, channel: LAUNCH_PAYMENT_CHANNEL });
    const payTwo = await initiatePayment(db, buyer, provider, { orderId: second.order.id, channel: LAUNCH_PAYMENT_CHANNEL });

    const eventOne = provider.event({
      id: "evt-twice-a", providerRef: payOne.providerRef as string, status: "succeeded",
      amountMinor: listing.priceMinor, currency: "XOF",
    });
    const eventTwo = provider.event({
      id: "evt-twice-b", providerRef: payTwo.providerRef as string, status: "succeeded",
      amountMinor: listing.priceMinor, currency: "XOF",
    });

    const results = await Promise.allSettled([
      applyProviderEvent(db, provider, eventOne.body, eventOne.headers),
      applyProviderEvent(db, provider, eventTwo.body, eventTwo.headers),
    ]);

    // Both confirmations succeed — the buyer really did pay twice, and refusing
    // the second would leave a captured charge with no order to explain it.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await statusOfOrder(first.order.id)).toBe("paid");
    expect(await statusOfOrder(second.order.id)).toBe("paid");

    // And there is exactly ONE grant. Access is not a quantity.
    expect((await listOwnEntitlements(db, buyer)).length).toBe(1);
    const grants = await db.execute<{ n: string }>(sql`
      select count(*) as n from entitlements where user_id = ${buyer.userId}::uuid
    `);
    expect(Number(grants.rows[0]?.n)).toBe(1);
  });

  it("cannot grant a second entitlement for a product already owned", async () => {
    const listing = await publishedProduct();
    const buyer = await makeBuyer();

    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "own-1",
    });
    const payment = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });
    const event = provider.event({
      id: "evt-own", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: listing.priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    // A second checkout for the same product is refused before it can start.
    await rejectsWith(
      createCheckout(db, buyer, {
        storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "own-2",
      }),
      AlreadyOwnedError,
    );
  });
});

describe("expiry", () => {
  it("sweeps lapsed checkouts and leaves paid ones alone", async () => {
    const lapsing = await pendingOrder();
    const paid = await pendingOrder();

    const event = provider.event({
      id: "evt-keep", providerRef: paid.payment.providerRef as string, status: "succeeded",
      amountMinor: paid.priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    await db.execute(sql`update orders set expires_at = now() - interval '1 second'`);
    const swept = await expireLapsedOrders(db);

    expect(swept).toBe(1);
    expect(await statusOfOrder(lapsing.order.id)).toBe("expired");
    expect(await statusOfOrder(paid.order.id)).toBe("paid");
  });

  it("does not leave a confirmation after expiry in limbo", async () => {
    /*
     * This test used to assert that a late confirmation moved the payment,
     * left the order expired, and granted nothing — money arriving and leaving
     * no commercial trace. That WAS the behaviour, it was raised as an open
     * risk, and the review gate decided it: an expired order now ends as
     * `paid` if fulfilling is still safe, or `refund_due` if it is not.
     *
     * What this test keeps is the invariant that matters here — a succeeded
     * payment never leaves its order in limbo. The policy's edges belong to
     * `late-payment.test.ts` and are proved there in detail.
     */
    const { order, payment, priceMinor } = await pendingOrder();
    await db.execute(sql`update orders set expires_at = now() - interval '1 second'`);
    await expireLapsedOrders(db);
    expect(await statusOfOrder(order.id)).toBe("expired");

    const late = provider.event({
      id: "evt-late", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    const result = await applyProviderEvent(db, provider, late.body, late.headers);

    expect(result.outcome).toBe("applied");
    // A second late, so inside the grace window: fulfilled.
    expect(await statusOfOrder(order.id)).toBe("paid");
    expect(["paid", "refund_due"]).toContain(await statusOfOrder(order.id));
  });
});

describe("reading orders is scoped to the reader", () => {
  it("does not show one buyer another buyer's order", async () => {
    const { order } = await pendingOrder();
    const stranger = await makeBuyer();
    await rejectsWith(findOwnOrder(db, stranger, order.id), OrderNotFoundError);
    expect(await listOwnOrders(db, stranger)).toEqual([]);
  });

  it("refuses a reader with no order.read_own permission", async () => {
    const { order } = await pendingOrder();
    const userId = await createTestUser(db, { locale: "fr" });
    await rejectsWith(findOwnOrder(db, { userId }, order.id), PermissionDeniedError);
  });
});

describe("payment_events is evidence", () => {
  it("refuses to let a recorded event be rewritten or removed", async () => {
    const { payment, priceMinor } = await pendingOrder();
    const event = provider.event({
      id: "evt-evidence", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    await expect(
      db.execute(sql`update payment_events set outcome = 'ignored' where provider_event_id = 'evt-evidence'`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from payment_events where provider_event_id = 'evt-evidence'`),
    ).rejects.toThrow();
  });
});

// The transition table is asserted directly as well, so a mutation that widens
// it fails here even if no scenario above happens to exercise that pair.
describe("InvalidTransitionError", () => {
  it("names the subject and both states", () => {
    const error = new InvalidTransitionError("payment", "succeeded", "failed");
    expect(error.code).toBe("order.invalid_transition");
    expect(error.message).toContain("succeeded");
    expect(error.message).toContain("failed");
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
