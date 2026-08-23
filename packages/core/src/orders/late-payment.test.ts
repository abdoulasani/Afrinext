import { sql } from "drizzle-orm";
import { LAUNCH_PAYMENT_CHANNEL } from "../payments";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getPool, type Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { commerceIsClean, reconcileCommerce } from "../ledger";
import { money } from "../money";
import { MockPaymentProvider } from "../payments";
import { createTestUser, ensureReferenceData, giveProductAFile, resetData, testDb } from "../test/harness";
import {
  applyProviderEvent, canTransitionOrder, createCheckout, DEFAULT_LATE_PAYMENT_GRACE_SECONDS,
  expireLapsedOrders, initiatePayment, isTerminalOrderState, LATE_PAYMENT_GRACE_SETTING_KEY,
  loadLatePaymentGraceSeconds,
} from "./index";

/**
 * The late-payment policy, at its edges.
 *
 * A verified successful payment can arrive after the checkout expired. The
 * money is real whatever our timer did, so the only question is whether
 * fulfilling is still safe:
 *
 *   inside the grace window and still safe   → expired → paid
 *   outside it, or no longer safe            → expired → refund_due
 *
 * `refund_due` is a queue. Nothing here refunds anything, and no test pretends
 * otherwise.
 */

const GRACE_MS = DEFAULT_LATE_PAYMENT_GRACE_SECONDS * 1000;

let db: Database;
let provider: MockPaymentProvider;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  provider = new MockPaymentProvider();
  await db.execute(sql`
    insert into commission_rules
      (id, transaction_type, rate_bps, currency, priority, effective_from)
    values (gen_random_uuid(), 'digital', 1800, 'XOF', 0, '2026-01-01T00:00:00Z')
  `);
  // The grace window is configuration and the harness truncates nothing that
  // holds it, but a previous test may have narrowed it. Restore the reviewed
  // value so each test starts from the documented policy.
  await db.execute(sql`
    insert into platform_settings (key, value, description)
    values (${LATE_PAYMENT_GRACE_SETTING_KEY}, ${String(DEFAULT_LATE_PAYMENT_GRACE_SECONDS)}::jsonb, 'test')
    on conflict (key) do update set value = ${String(DEFAULT_LATE_PAYMENT_GRACE_SECONDS)}::jsonb
  `);
});

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

async function makeBuyer(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  return { userId };
}

let counter = 0;

interface Sale {
  buyer: Actor;
  orderId: string;
  paymentRef: string;
  productId: string;
  storeId: string;
  storeSlug: string;
  productSlug: string;
  expiresAt: Date;
}

/** A real published product, a real checkout, a real charge in flight. */
async function pendingSale(): Promise<Sale> {
  counter += 1;
  const sellerId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(sellerId, "member");
  await grantGlobal(sellerId, "seller");
  await acceptCurrentVersions(db, sellerId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  await acceptCurrentVersions(db, sellerId, ["seller_terms"], { locale: "fr" }, { method: "signup" });
  const seller = { userId: sellerId };

  const store = await createStore(db, seller, { storeType: "digital_product", name: `B ${counter}`, slug: `b-${counter}` });
  await publishStore(db, seller, store.id);
  const product = await createProduct(db, seller, {
    storeId: store.id, title: `P ${counter}`, slug: `p-${counter}`, price: money(5000n, "XOF"),
  });
  await giveProductAFile(db, product.id);
  await publishProduct(db, seller, product.id);

  const buyer = await makeBuyer();
  const { order } = await createCheckout(db, buyer, {
    storeSlug: store.slug, productSlug: product.slug, checkoutKey: `k-${counter}`,
  });
  const payment = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });

  return {
    buyer,
    orderId: order.id,
    paymentRef: payment.providerRef as string,
    productId: product.id,
    storeId: store.id,
    storeSlug: store.slug,
    productSlug: product.slug,
    expiresAt: order.expiresAt,
  };
}

/** Ages the checkout out and sweeps it, as the passage of time would. */
async function expire(sale: Sale): Promise<void> {
  await db.execute(sql`
    update orders set expires_at = now() - interval '1 second' where id = ${sale.orderId}::uuid
  `);
  await expireLapsedOrders(db);
}

function succeeded(sale: Sale, id: string) {
  return provider.event({
    id, providerRef: sale.paymentRef, status: "succeeded",
    amountMinor: 5000n, currency: "XOF",
  });
}

async function stateOf(orderId: string): Promise<{
  order: string; payment: string; entitlements: number; fees: number; late: boolean;
}> {
  const o = await db.execute<{ status: string; late_payment_at: string | null }>(sql`
    select status, late_payment_at::text from orders where id = ${orderId}::uuid`);
  const p = await db.execute<{ status: string }>(sql`
    select status from payments where order_id = ${orderId}::uuid`);
  const e = await db.execute<{ n: string }>(sql`
    select count(*) as n from entitlements where order_id = ${orderId}::uuid`);
  const f = await db.execute<{ n: string }>(sql`
    select count(*) as n from fee_schedules where subject_type = 'order' and subject_id = ${orderId}::uuid`);
  return {
    order: o.rows[0]?.status ?? "gone",
    payment: p.rows[0]?.status ?? "none",
    entitlements: Number(e.rows[0]?.n),
    fees: Number(f.rows[0]?.n),
    late: o.rows[0]?.late_payment_at !== null,
  };
}

/** Reads the order's expiry back, so the boundary can be computed exactly. */
async function expiresAt(orderId: string): Promise<number> {
  const rows = await db.execute<{ expires_at: Date | string }>(sql`
    select expires_at from orders where id = ${orderId}::uuid`);
  const v = rows.rows[0]!.expires_at;
  return (v instanceof Date ? v : new Date(v)).getTime();
}

// ---------------------------------------------------------------------------

describe("1 · the ordinary path is untouched", () => {
  it("fulfils a payment confirmed before expiry", async () => {
    const sale = await pendingSale();
    const event = succeeded(sale, "evt-1");
    const applied = await applyProviderEvent(db, provider, event.body, event.headers);

    expect(applied.orderStatus).toBe("paid");
    expect(await stateOf(sale.orderId)).toEqual({
      order: "paid", payment: "succeeded", entitlements: 1, fees: 1, late: false,
    });
  });
});

describe("2–5 · the grace window, at its edges", () => {
  it("fulfils a payment confirmed one second after expiry", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);

    const event = succeeded(sale, "evt-2");
    const applied = await applyProviderEvent(
      db, provider, event.body, event.headers, boundary + 1000,
    );

    expect(applied.orderStatus).toBe("paid");
    expect(applied.reason).toBe("late_accepted");
    const state = await stateOf(sale.orderId);
    expect(state).toEqual({
      order: "paid", payment: "succeeded", entitlements: 1, fees: 1, late: true,
    });
  });

  it("fulfils a payment confirmed well inside the window", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);

    const event = succeeded(sale, "evt-3");
    await applyProviderEvent(db, provider, event.body, event.headers, boundary + GRACE_MS / 2);

    expect((await stateOf(sale.orderId)).order).toBe("paid");
  });

  it("fulfils a payment confirmed EXACTLY at the boundary", async () => {
    /*
     * The documented rule: grace applies when the payment arrives at or before
     * expiry + 24 hours. `<=`, not `<`. Testing it at the exact millisecond is
     * why `applyProviderEvent` takes a clock — a boundary nobody can land on
     * is a boundary nobody has checked.
     */
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);

    const event = succeeded(sale, "evt-4");
    const applied = await applyProviderEvent(
      db, provider, event.body, event.headers, boundary + GRACE_MS,
    );

    expect(applied.orderStatus).toBe("paid");
    expect((await stateOf(sale.orderId)).entitlements).toBe(1);
  });

  it("queues a refund one millisecond past the boundary", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);

    const event = succeeded(sale, "evt-5");
    const applied = await applyProviderEvent(
      db, provider, event.body, event.headers, boundary + GRACE_MS + 1,
    );

    expect(applied.orderStatus).toBe("refund_due");
    expect(applied.reason).toBe("grace_window_elapsed");
    expect(await stateOf(sale.orderId)).toEqual({
      // The payment still succeeded — it did. What did not happen is fulfilment.
      order: "refund_due", payment: "succeeded", entitlements: 0, fees: 0, late: true,
    });
  });

  it("queues a refund long after the window", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);

    const event = succeeded(sale, "evt-6");
    await applyProviderEvent(db, provider, event.body, event.headers, boundary + 30 * GRACE_MS);

    expect((await stateOf(sale.orderId)).order).toBe("refund_due");
  });
});

describe("6 · confirmation racing expiry", () => {
  it("produces one deterministic outcome, never both", async () => {
    const sale = await pendingSale();
    await db.execute(sql`
      update orders set expires_at = now() - interval '1 second' where id = ${sale.orderId}::uuid
    `);

    const event = succeeded(sale, "evt-race");
    // The sweeper and the webhook arrive together. The order row is locked for
    // update inside the confirmation, so they queue rather than interleave.
    const [, applied] = await Promise.all([
      expireLapsedOrders(db),
      applyProviderEvent(db, provider, event.body, event.headers),
    ]);

    const state = await stateOf(sale.orderId);
    // Either the confirmation won and the order is paid, or the sweeper won and
    // the confirmation took the late path and accepted it — this is well inside
    // the grace window. Both are `paid`; neither leaves the payment orphaned.
    expect(state.order).toBe("paid");
    expect(state.payment).toBe("succeeded");
    expect(state.entitlements).toBe(1);
    expect(["paid"]).toContain(applied.orderStatus);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("waits for a held row lock, and decides on what it finds afterwards", async () => {
    /*
     * The race, made deterministic.
     *
     * `Promise.all` cannot reliably interleave two transactions, so this test
     * holds the order row itself: a separate connection takes `for update`,
     * the confirmation arrives and must WAIT, the holder then expires the
     * order and commits, and only then does the confirmation get to look.
     *
     * With the lock, the confirmation sees `expired` and takes the late path,
     * which accepts it — one second late is inside the window. Without the
     * lock, it reads the pre-expiry snapshot, takes the ordinary path, and its
     * guarded UPDATE then matches nothing: the payment succeeds and the order
     * is left expired, which is precisely the orphaned state this whole gate
     * exists to abolish.
     */
    const sale = await pendingSale();
    const holder = await getPool().connect();

    let applied: Awaited<ReturnType<typeof applyProviderEvent>>;
    try {
      await holder.query("begin");
      await holder.query("select id from orders where id = $1 for update", [sale.orderId]);

      const event = succeeded(sale, "evt-lock");
      const confirmation = applyProviderEvent(db, provider, event.body, event.headers);

      // Give the confirmation time to reach the lock and block on it.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await holder.query(
        "update orders set status = 'expired', expires_at = now() - interval '1 second'," +
          " closed_at = now() where id = $1",
        [sale.orderId],
      );
      await holder.query("commit");

      applied = await confirmation;
    } finally {
      holder.release();
    }

    expect(applied.outcome).toBe("applied");
    expect(applied.orderStatus, "the confirmation must see the expiry it waited for").toBe("paid");
    expect(applied.reason).toBe("late_accepted");

    const state = await stateOf(sale.orderId);
    expect(state.order).toBe("paid");
    expect(state.late, "and know it was late").toBe(true);
    expect(state.entitlements).toBe(1);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("never grants twice when many confirmations race an expiry", async () => {
    const sale = await pendingSale();
    await db.execute(sql`
      update orders set expires_at = now() - interval '1 second' where id = ${sale.orderId}::uuid
    `);
    const event = succeeded(sale, "evt-race-many");

    await Promise.allSettled([
      expireLapsedOrders(db),
      applyProviderEvent(db, provider, event.body, event.headers),
      applyProviderEvent(db, provider, event.body, event.headers),
      applyProviderEvent(db, provider, event.body, event.headers),
      expireLapsedOrders(db),
    ]);

    const state = await stateOf(sale.orderId);
    expect(state.entitlements).toBe(1);
    expect(state.fees).toBe(1);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });
});

describe("7–8 · a late confirmation is still idempotent", () => {
  it("applies a duplicate webhook exactly once", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);
    const event = succeeded(sale, "evt-dup");

    const first = await applyProviderEvent(db, provider, event.body, event.headers, boundary + 1000);
    const second = await applyProviderEvent(db, provider, event.body, event.headers, boundary + 1000);
    const third = await applyProviderEvent(db, provider, event.body, event.headers, boundary + 1000);

    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("ignored");
    expect(third.outcome).toBe("ignored");
    expect(await stateOf(sale.orderId)).toEqual({
      order: "paid", payment: "succeeded", entitlements: 1, fees: 1, late: true,
    });
  });

  it("ignores a second event id for the same charge", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);

    await applyProviderEvent(db, provider, succeeded(sale, "evt-a").body,
      succeeded(sale, "evt-a").headers, boundary + 1000);
    const again = succeeded(sale, "evt-b");
    const result = await applyProviderEvent(db, provider, again.body, again.headers, boundary + 2000);

    expect(result.outcome).toBe("ignored");
    expect((await stateOf(sale.orderId)).entitlements).toBe(1);
  });

  it("does not reopen a refund_due order with a later event", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);

    const late = succeeded(sale, "evt-late");
    await applyProviderEvent(db, provider, late.body, late.headers, boundary + GRACE_MS + 1);
    expect((await stateOf(sale.orderId)).order).toBe("refund_due");

    // A retry inside the window cannot rescue it: the payment is already
    // terminal, so the event is stale before the policy is even consulted.
    const retry = succeeded(sale, "evt-late-2");
    const result = await applyProviderEvent(db, provider, retry.body, retry.headers, boundary + 1000);
    expect(result.outcome).toBe("ignored");
    expect((await stateOf(sale.orderId)).order).toBe("refund_due");
  });
});

describe("9–12 · fulfilment must still be safe", () => {
  it("queues a refund when the buyer already owns the product", async () => {
    /*
     * The case the whole policy exists for.
     *
     * The buyer gave up on the expired checkout, bought again, and was
     * fulfilled. The first payment then confirms. Granting again would be
     * absorbed by the unique index and the buyer would have paid twice for one
     * thing — so this is a refund, explicitly.
     */
    const first = await pendingSale();
    await expire(first);

    const second = await createCheckout(db, first.buyer, {
      storeSlug: first.storeSlug, productSlug: first.productSlug, checkoutKey: "second-go",
    });
    const secondPayment = await initiatePayment(db, first.buyer, provider, {
      orderId: second.order.id, channel: LAUNCH_PAYMENT_CHANNEL,
    });
    const paid = provider.event({
      id: "evt-second", providerRef: secondPayment.providerRef as string,
      status: "succeeded", amountMinor: 5000n, currency: "XOF",
    });
    await applyProviderEvent(db, provider, paid.body, paid.headers);
    expect((await stateOf(second.order.id)).order).toBe("paid");

    const boundary = await expiresAt(first.orderId);
    const late = succeeded(first, "evt-first-late");
    const applied = await applyProviderEvent(
      db, provider, late.body, late.headers, boundary + 1000,
    );

    expect(applied.orderStatus).toBe("refund_due");
    expect(applied.reason).toBe("already_owned");

    // One grant, two payments, and the second one is queued rather than eaten.
    const grants = await db.execute<{ n: string }>(sql`
      select count(*) as n from entitlements where user_id = ${first.buyer.userId}::uuid`);
    expect(Number(grants.rows[0]?.n)).toBe(1);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("queues a refund when the product was unpublished meanwhile", async () => {
    const sale = await pendingSale();
    await expire(sale);
    await db.execute(sql`update products set status = 'archived' where id = ${sale.productId}::uuid`);

    const boundary = await expiresAt(sale.orderId);
    const late = succeeded(sale, "evt-unpub");
    const applied = await applyProviderEvent(db, provider, late.body, late.headers, boundary + 1000);

    expect(applied.orderStatus).toBe("refund_due");
    expect(applied.reason).toBe("product_unpublished");
    expect((await stateOf(sale.orderId)).entitlements).toBe(0);
  });

  it("queues a refund when the store became ineligible meanwhile", async () => {
    const sale = await pendingSale();
    await expire(sale);
    await db.execute(sql`update stores set status = 'suspended' where id = ${sale.storeId}::uuid`);

    const boundary = await expiresAt(sale.orderId);
    const late = succeeded(sale, "evt-susp");
    const applied = await applyProviderEvent(db, provider, late.body, late.headers, boundary + 1000);

    expect(applied.orderStatus).toBe("refund_due");
    expect(applied.reason).toBe("store_unpublished");
  });

  it("reports every blocking reason, not just the first", async () => {
    const sale = await pendingSale();
    await expire(sale);
    await db.execute(sql`update products set status = 'archived' where id = ${sale.productId}::uuid`);
    await db.execute(sql`update stores set status = 'suspended' where id = ${sale.storeId}::uuid`);

    const boundary = await expiresAt(sale.orderId);
    const late = succeeded(sale, "evt-both");
    const applied = await applyProviderEvent(
      db, provider, late.body, late.headers, boundary + GRACE_MS + 1,
    );

    expect(applied.reason).toContain("grace_window_elapsed");
    expect(applied.reason).toContain("product_unpublished");
    expect(applied.reason).toContain("store_unpublished");
  });

  it("does not queue a refund for a FAILED payment after expiry", async () => {
    // Rule 3 is about successful payments. A late failure is just a failure:
    // no money arrived, so there is nothing to refund and nothing to fulfil.
    const sale = await pendingSale();
    await expire(sale);

    const failed = provider.event({
      id: "evt-fail", providerRef: sale.paymentRef, status: "failed",
    });
    const applied = await applyProviderEvent(db, provider, failed.body, failed.headers);

    expect(applied.orderStatus).toBe("expired");
    expect(await stateOf(sale.orderId)).toEqual({
      order: "expired", payment: "failed", entitlements: 0, fees: 0, late: false,
    });
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });
});

describe("13 · a successful payment can never become invisible", () => {
  it("leaves every succeeded payment in paid or refund_due", async () => {
    const fulfilled = await pendingSale();
    const refundable = await pendingSale();
    const onTime = await pendingSale();

    await expire(fulfilled);
    await expire(refundable);

    const a = succeeded(fulfilled, "evt-v1");
    await applyProviderEvent(db, provider, a.body, a.headers,
      (await expiresAt(fulfilled.orderId)) + 1000);

    const b = succeeded(refundable, "evt-v2");
    await applyProviderEvent(db, provider, b.body, b.headers,
      (await expiresAt(refundable.orderId)) + GRACE_MS + 1);

    const c = succeeded(onTime, "evt-v3");
    await applyProviderEvent(db, provider, c.body, c.headers);

    const rows = await db.execute<{ [key: string]: unknown; order_status: string; n: string }>(sql`
      select o.status as order_status, count(*) as n
        from payments p join orders o on o.id = p.order_id
       where p.status = 'succeeded' group by o.status order by 1
    `);
    expect(rows.rows.map((r) => r.order_status)).toEqual(["paid", "refund_due"]);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("audits the decision, in words, for every outcome", async () => {
    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);
    const late = succeeded(sale, "evt-audit");
    await applyProviderEvent(db, provider, late.body, late.headers, boundary + GRACE_MS + 1);

    const rows = await db.execute<{ action: string; context: { decision?: string } }>(sql`
      select action, context from audit_logs
       where target_id = ${sale.orderId} and action like 'order.payment%'
       order by occurred_at desc limit 1
    `);
    expect(rows.rows[0]?.action).toBe("order.payment.refund_due");
    expect(rows.rows[0]?.context.decision).toBe("grace_window_elapsed");
  });
});

describe("the grace window is configuration, and cannot be widened by one", () => {
  it("reads a narrower window from settings", async () => {
    await db.execute(sql`
      update platform_settings set value = '60'::jsonb where key = ${LATE_PAYMENT_GRACE_SETTING_KEY}
    `);
    expect(await loadLatePaymentGraceSeconds(db)).toBe(60);

    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);
    const late = succeeded(sale, "evt-narrow");
    const applied = await applyProviderEvent(
      db, provider, late.body, late.headers, boundary + 61_000,
    );
    expect(applied.orderStatus).toBe("refund_due");
  });

  it("CLAMPS a wider one to the reviewed maximum", async () => {
    /*
     * The asymmetry is the point. Narrowing is an operator's call; widening is
     * a policy change and needs the review that produced the number. A setting
     * that could open the gate wider than the documented default would make the
     * documentation a suggestion.
     */
    await db.execute(sql`
      update platform_settings set value = '999999999'::jsonb where key = ${LATE_PAYMENT_GRACE_SETTING_KEY}
    `);
    expect(await loadLatePaymentGraceSeconds(db)).toBe(DEFAULT_LATE_PAYMENT_GRACE_SECONDS);

    const sale = await pendingSale();
    await expire(sale);
    const boundary = await expiresAt(sale.orderId);
    const late = succeeded(sale, "evt-wide");
    const applied = await applyProviderEvent(
      db, provider, late.body, late.headers, boundary + GRACE_MS + 1,
    );
    expect(applied.orderStatus, "a huge setting must not widen the policy").toBe("refund_due");
  });

  it("falls back to the reviewed value for a malformed setting", async () => {
    for (const bad of ['"soon"', "-1", "null", '{"seconds":10}']) {
      await db.execute(sql`
        update platform_settings set value = ${bad}::jsonb where key = ${LATE_PAYMENT_GRACE_SETTING_KEY}
      `);
      expect(await loadLatePaymentGraceSeconds(db), bad).toBe(DEFAULT_LATE_PAYMENT_GRACE_SECONDS);
    }
    await db.execute(sql`delete from platform_settings where key = ${LATE_PAYMENT_GRACE_SETTING_KEY}`);
    expect(await loadLatePaymentGraceSeconds(db)).toBe(DEFAULT_LATE_PAYMENT_GRACE_SECONDS);
  });
});

describe("the state machine says what the database enforces", () => {
  it("allows expired → paid and expired → refund_due, and nothing else new", () => {
    expect(canTransitionOrder("expired", "paid")).toBe(true);
    expect(canTransitionOrder("expired", "refund_due")).toBe(true);
    expect(canTransitionOrder("expired", "cancelled")).toBe(false);
    expect(canTransitionOrder("expired", "pending_payment")).toBe(false);
    expect(isTerminalOrderState("refund_due")).toBe(true);
    expect(isTerminalOrderState("paid")).toBe(true);
    // Expired is the ONE state that can be left, because money can arrive after it.
    expect(isTerminalOrderState("expired")).toBe(false);
  });

  it("refuses a status the CHECK constraint does not know", async () => {
    const sale = await pendingSale();
    await expect(
      db.execute(sql`update orders set status = 'refunded' where id = ${sale.orderId}::uuid`),
    ).rejects.toThrow();
  });
});

describe("14 · commerce reconciliation catches each impossible state", () => {
  async function anomalies(): Promise<string[]> {
    return (await reconcileCommerce(db)).anomalies.map((a) => a.kind);
  }

  it("is silent over a healthy world", async () => {
    const sale = await pendingSale();
    const event = succeeded(sale, "evt-ok");
    await applyProviderEvent(db, provider, event.body, event.headers);
    expect(await anomalies()).toEqual([]);
  });

  it("catches a succeeded payment whose order is neither paid nor refund_due", async () => {
    const sale = await pendingSale();
    const event = succeeded(sale, "evt-orphan");
    await applyProviderEvent(db, provider, event.body, event.headers);
    // Exactly the state the review gate was opened for, forced into existence.
    await db.execute(sql`
      update orders set status = 'expired', paid_at = null where id = ${sale.orderId}::uuid`);
    expect(await anomalies()).toContain("succeeded_payment_orphaned");
  });

  it("catches a paid order with no succeeded payment", async () => {
    const sale = await pendingSale();
    const event = succeeded(sale, "evt-nopay");
    await applyProviderEvent(db, provider, event.body, event.headers);
    await db.execute(sql`
      update payments set status = 'failed', confirmed_at = null where order_id = ${sale.orderId}::uuid`);
    expect(await anomalies()).toContain("paid_order_without_payment");
  });

  it("catches two succeeded payments for one order", async () => {
    const sale = await pendingSale();
    const event = succeeded(sale, "evt-two");
    await applyProviderEvent(db, provider, event.body, event.headers);
    await db.execute(sql`
      insert into payments (id, order_id, provider, provider_ref, status, amount_minor,
                            currency, idempotency_key, confirmed_at)
      select gen_random_uuid(), ${sale.orderId}::uuid, 'mock', ${"dup-" + sale.orderId},
             'succeeded', 5000, 'XOF', ${"dupkey-" + sale.orderId}, now()`);
    expect(await anomalies()).toContain("multiple_succeeded_payments");
  });

  it("catches a refund_due order with no succeeded payment", async () => {
    const sale = await pendingSale();
    await expire(sale);
    await db.execute(sql`
      update orders set status = 'refund_due', late_payment_at = now()
       where id = ${sale.orderId}::uuid`);
    expect(await anomalies()).toContain("refund_due_without_payment");
  });

  it("catches a duplicate entitlement if the index ever stops preventing one", async () => {
    const sale = await pendingSale();
    const event = succeeded(sale, "evt-ent");
    await applyProviderEvent(db, provider, event.body, event.headers);

    // The unique index makes this unreachable through the domain, so the test
    // drops it to prove the DETECTOR works — the guard against someone deciding
    // that index looks unnecessary.
    await db.execute(sql`drop index entitlements_user_product_key`);
    await db.execute(sql`
      insert into entitlements (id, user_id, product_id, order_id, source)
      select gen_random_uuid(), user_id, product_id, order_id, 'purchase'
        from entitlements where order_id = ${sale.orderId}::uuid`);
    try {
      expect(await anomalies()).toContain("duplicate_entitlement");
    } finally {
      await db.execute(sql`
        delete from entitlements a using entitlements b
         where a.user_id = b.user_id and a.product_id = b.product_id and a.id > b.id`);
      await db.execute(sql`
        create unique index entitlements_user_product_key on entitlements (user_id, product_id)`);
    }
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
