import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@afrinext/db";
import { uuidv7 } from "../src/ids";
import { money } from "../src/money";
import {
  approvePayout, recordCapture, recordProviderSettlement, settlePayout, settleSale,
} from "../src/ledger/flows";
import { reconcile, reconciliationIsClean } from "../src/ledger/reconcile";
import { commerceIsClean, reconcileCommerce } from "../src/ledger/commerce-reconcile";

/**
 * CI gate: run one full economic cycle, then assert the books balance.
 *
 * The suite truncates between tests, so reconciling an empty ledger would
 * assert nothing. This posts a real capture → settlement → payout cycle first,
 * so every CI run proves the invariants on actual movements: every transaction
 * balances, the whole ledger nets to zero per currency, and every cached
 * balance equals the sum of its entries.
 */
async function main(): Promise<void> {
  const testUrl = process.env["TEST_DATABASE_URL"];
  if (testUrl !== undefined && testUrl !== "") process.env["DATABASE_URL"] = testUrl;

  const db = getDb();
  const run = uuidv7();
  const seller = uuidv7();
  const ambassador = uuidv7();

  // Ledger accounts reference a user only by id, but create the rows so the
  // scenario matches how the application actually posts.
  await db.execute(sql`
    insert into users (id, locale) values (${seller}, 'fr'), (${ambassador}, 'fr')
    on conflict do nothing
  `);

  const gross = money(10_000n, "XOF");
  await recordCapture(db, { gross, idempotencyKey: `ci-cap-${run}` });
  await recordProviderSettlement(db, { gross, idempotencyKey: `ci-psp-${run}` });
  const settlement = await settleSale(db, {
    gross,
    sellerUserId: seller,
    platformRateBps: 1800,
    referral: { ambassadorUserId: ambassador, rateBps: 1000 },
    holdSellerFunds: false,
    idempotencyKey: `ci-set-${run}`,
  });
  await approvePayout(db, {
    userId: seller,
    amount: settlement.sellerAmount,
    idempotencyKey: `ci-apr-${run}`,
    approvedBy: ambassador,
  });
  await settlePayout(db, {
    amount: settlement.sellerAmount,
    idempotencyKey: `ci-stl-${run}`,
  });

  const report = await reconcile(db);
  /*
   * The commerce invariants, over whatever the suite left behind.
   *
   * Deliberately NOT over a scenario built here. The ledger half posts its own
   * cycle because the suite truncates and an empty ledger asserts nothing; the
   * commerce half is the opposite — it is most useful applied to the orders and
   * payments the tests actually created, because those are the states the code
   * really produces.
   */
  const commerce = await reconcileCommerce(db);

  /*
   * And a live proof that the commerce detector still detects.
   *
   * A gate that reports "clean" is only worth anything if it can report
   * something else. The suite truncates between tests, so on some runs there
   * would be no orders left to check and the assertion would pass vacuously —
   * exactly the failure mode this whole review gate exists to close.
   *
   * So the script builds one consistent order-and-payment pair, requires the
   * detector to stay silent, breaks it in the one way the gate is meant to
   * notice, requires the detector to speak, and puts it back.
   */
  const probe = await probeCommerceDetector(db);

  /*
   * And the same proof for the refund detectors.
   *
   * Phase 3 added ten checks over a table that is empty on most CI runs, so
   * "no anomalies" from them proves nothing on its own. This builds a
   * consistent refund, requires silence, breaks the one invariant that would
   * cost real money — the frozen amount drifting from its payment — requires
   * the detector to speak, and cleans up.
   */
  const refundProbe = await probeRefundDetector(db);

  const summary = {
    scenario: {
      gross: gross.amountMinor.toString(),
      seller: settlement.sellerAmount.amountMinor.toString(),
      platform: settlement.platformAmount.amountMinor.toString(),
      referral: settlement.referralAmount?.amountMinor.toString() ?? null,
    },
    checkedAccounts: report.checkedAccounts,
    drift: report.drift.length,
    unbalancedTransactions: report.unbalancedTransactions.length,
    netByCurrency: Object.fromEntries(
      [...report.systemNetByCurrency].map(([c, n]) => [c, n.toString()]),
    ),
    commerce: {
      ordersChecked: commerce.ordersChecked,
      paymentsChecked: commerce.paymentsChecked,
      refundsChecked: commerce.refundsChecked,
      anomalies: commerce.anomalies,
      detectorProof: probe,
      refundDetectorProof: refundProbe,
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  const splitSums =
    settlement.sellerAmount.amountMinor +
    settlement.platformAmount.amountMinor +
    (settlement.referralAmount?.amountMinor ?? 0n);

  await closeDb();

  if (splitSums !== gross.amountMinor) {
    console.error(`Split does not re-sum to gross: ${splitSums} vs ${gross.amountMinor}`);
    process.exit(1);
  }
  if (report.checkedAccounts === 0) {
    console.error("Reconciliation checked no accounts — the gate would be vacuous.");
    process.exit(1);
  }
  if (!probe.silentWhenConsistent || probe.detectedWhenBroken !== "succeeded_payment_orphaned") {
    console.error(
      "The commerce detector did not behave: " + JSON.stringify(probe) +
        "\nA reconciliation that cannot report a fault is not a gate.",
    );
    process.exit(1);
  }
  if (
    !refundProbe.silentWhenConsistent ||
    refundProbe.detectedWhenBroken !== "refund_amount_mismatch"
  ) {
    console.error(
      "The refund detector did not behave: " + JSON.stringify(refundProbe) +
        "\nA reconciliation that cannot report a fault is not a gate.",
    );
    process.exit(1);
  }
  if (!commerceIsClean(commerce)) {
    console.error(
      "Commerce reconciliation found impossible states:\n" +
        commerce.anomalies.map((a) => `  ${a.kind} ${a.subject}: ${a.detail}`).join("\n"),
    );
    process.exit(1);
  }
  if (!reconciliationIsClean(report)) {
    console.error("Ledger reconciliation FAILED — the books do not balance.");
    process.exit(1);
  }
  console.log("Ledger reconciliation clean over a real capture → settlement → payout cycle.");
}

/**
 * Builds a consistent order and payment, checks, breaks, checks — then the
 * whole thing is rolled back.
 *
 * Raw SQL on purpose: the point is to exercise the DETECTOR, so going through
 * the domain — which is what makes these states unreachable — would prove
 * nothing about the query.
 */
async function probeCommerceDetector(
  db: ReturnType<typeof getDb>,
): Promise<{ silentWhenConsistent: boolean; detectedWhenBroken: string | null }> {
  return inRolledBackTransaction(db, probeCommerceInside);
}

/**
 * Runs a probe inside a transaction that is always rolled back.
 *
 * The probes plant rows that are deliberately wrong, so they must leave nothing
 * behind — and deleting afterwards is the wrong instrument. Several of these
 * tables refuse DELETE by design (a refund is resolved, never erased), and a
 * cleanup that has to disable a trigger is a cleanup that could disable the
 * wrong one. A rollback removes everything without asking any table's
 * permission, and it removes the rows even if the probe throws halfway.
 */
async function inRolledBackTransaction<T>(
  db: ReturnType<typeof getDb>,
  body: (tx: ReturnType<typeof getDb>) => Promise<T>,
): Promise<T> {
  class Rollback extends Error {
    constructor(readonly value: T) { super("probe rollback"); }
  }
  try {
    await db.transaction(async (tx) => {
      throw new Rollback(await body(tx as unknown as ReturnType<typeof getDb>));
    });
  } catch (error: unknown) {
    if (error instanceof Rollback) return error.value;
    throw error;
  }
  throw new Error("the probe transaction committed, which it must never do");
}

async function probeCommerceInside(
  db: ReturnType<typeof getDb>,
): Promise<{ silentWhenConsistent: boolean; detectedWhenBroken: string | null }> {
  const buyer = uuidv7();
  const seller = uuidv7();
  const storeId = uuidv7();
  const productId = uuidv7();
  const orderId = uuidv7();
  const paymentId = uuidv7();
  const tag = orderId.slice(0, 8);

  await db.execute(sql`
    insert into users (id, locale, status) values (${buyer}, 'fr', 'active'), (${seller}, 'fr', 'active')
  `);
  await db.execute(sql`
    insert into stores (id, owner_user_id, slug, name, status)
    values (${storeId}, ${seller}, ${"probe-" + tag}, 'Probe', 'published')
  `);
  await db.execute(sql`
    insert into products (id, store_id, slug, kind, title, price_minor, currency, status, published_at)
    values (${productId}, ${storeId}, ${"probe-" + tag}, 'digital', 'Probe', 1000, 'XOF', 'published', now())
  `);
  await db.execute(sql`
    insert into orders (id, buyer_user_id, store_id, checkout_key, status, total_minor,
                        currency, expires_at, paid_at, closed_at)
    values (${orderId}, ${buyer}, ${storeId}, ${"probe-" + tag}, 'paid', 1000, 'XOF',
            now() + interval '1 hour', now(), now())
  `);
  await db.execute(sql`
    insert into order_items (id, order_id, product_id, store_id, title_snapshot,
                             unit_price_minor, currency, quantity, line_total_minor)
    values (${uuidv7()}, ${orderId}, ${productId}, ${storeId}, 'Probe', 1000, 'XOF', 1, 1000)
  `);
  await db.execute(sql`
    insert into payments (id, order_id, provider, provider_ref, status, amount_minor,
                          currency, idempotency_key, confirmed_at)
    values (${paymentId}, ${orderId}, 'probe', ${"probe-" + tag}, 'succeeded', 1000, 'XOF',
            ${"probe-" + tag}, now())
  `);

  /*
   * Silent about THESE rows, not silent about the whole database.
   *
   * Asserting a globally empty report makes the probe a hostage to whatever
   * the suite left behind: one unrelated anomaly and the probe reports that it
   * cannot detect, which is the opposite of the truth. What the probe is
   * entitled to claim is that the rows IT built produce nothing.
   */
  const mine = new Set([paymentId, orderId, storeId, productId, buyer, seller]);
  const consistent = await reconcileCommerce(db);
  const silentWhenConsistent = !consistent.anomalies.some((a) => mine.has(a.subject));

  // Break exactly one invariant: the order stops agreeing with its payment.
  await db.execute(sql`
    update orders set status = 'expired', paid_at = null where id = ${orderId}::uuid
  `);
  const broken = await reconcileCommerce(db);
  const detected = broken.anomalies.find((a) => a.subject === paymentId);

  // No cleanup: the caller rolls the whole thing back.
  return { silentWhenConsistent, detectedWhenBroken: detected?.kind ?? null };
}

/**
 * Builds a consistent refund, checks, breaks, checks, restores.
 *
 * Raw SQL, and for the same reason as the commerce probe: the point is to
 * exercise the DETECTOR. Going through the domain — which is what makes these
 * states unreachable — would prove nothing about the query.
 */
async function probeRefundDetector(
  db: ReturnType<typeof getDb>,
): Promise<{ silentWhenConsistent: boolean; detectedWhenBroken: string | null }> {
  return inRolledBackTransaction(db, probeRefundInside);
}

async function probeRefundInside(
  db: ReturnType<typeof getDb>,
): Promise<{ silentWhenConsistent: boolean; detectedWhenBroken: string | null }> {
  const buyer = uuidv7();
  const seller = uuidv7();
  const storeId = uuidv7();
  const productId = uuidv7();
  const orderId = uuidv7();
  const paymentId = uuidv7();
  const refundId = uuidv7();
  const tag = refundId.slice(0, 8);

  await db.execute(sql`
    insert into users (id, locale, status) values (${buyer}, 'fr', 'active'), (${seller}, 'fr', 'active')
  `);
  await db.execute(sql`
    insert into stores (id, owner_user_id, slug, name, status)
    values (${storeId}, ${seller}, ${"rprobe-" + tag}, 'Refund probe', 'published')
  `);
  await db.execute(sql`
    insert into products (id, store_id, slug, kind, title, price_minor, currency, status, published_at)
    values (${productId}, ${storeId}, ${"rprobe-" + tag}, 'digital', 'Refund probe', 1000,
            'XOF', 'published', now())
  `);
  // refund_due, which is where a refund legitimately comes from.
  await db.execute(sql`
    insert into orders (id, buyer_user_id, store_id, checkout_key, status, total_minor,
                        currency, expires_at, late_payment_at, closed_at)
    values (${orderId}, ${buyer}, ${storeId}, ${"rprobe-" + tag}, 'refund_due', 1000, 'XOF',
            now() - interval '2 days', now(), now())
  `);
  await db.execute(sql`
    insert into order_items (id, order_id, product_id, store_id, title_snapshot,
                             unit_price_minor, currency, quantity, line_total_minor)
    values (${uuidv7()}, ${orderId}, ${productId}, ${storeId}, 'Refund probe', 1000, 'XOF', 1, 1000)
  `);
  await db.execute(sql`
    insert into payments (id, order_id, provider, provider_ref, status, amount_minor,
                          currency, idempotency_key, confirmed_at)
    values (${paymentId}, ${orderId}, 'probe', ${"rprobe-" + tag}, 'succeeded', 1000, 'XOF',
            ${"rprobe-" + tag}, now())
  `);
  await db.execute(sql`
    insert into refunds (id, order_id, payment_id, provider, status, amount_minor,
                         currency, reason)
    values (${refundId}, ${orderId}, ${paymentId}, 'probe', 'owed', 1000, 'XOF',
            'grace_window_elapsed')
  `);

  const mine = new Set([refundId, paymentId, orderId, storeId, productId, buyer, seller]);
  const consistent = await reconcileCommerce(db);
  const silentWhenConsistent = !consistent.anomalies.some((a) => mine.has(a.subject));

  /*
   * Break exactly one invariant: the refund's frozen amount stops matching its
   * payment.
   *
   * Edited on the PAYMENT side, because the refund's snapshot is frozen by a
   * trigger and cannot be edited at all. That is the stronger arrangement and
   * it makes the probe more honest: the detector's job is to notice the two
   * disagreeing, from whichever side drifted.
   */
  await db.execute(sql`update payments set amount_minor = 999 where id = ${paymentId}::uuid`);
  const broken = await reconcileCommerce(db);
  const detected = broken.anomalies.find((a) => a.subject === refundId);

  // No cleanup: the caller rolls the whole thing back. The refund row could
  // not be deleted anyway — a refund is resolved, never erased.
  return { silentWhenConsistent, detectedWhenBroken: detected?.kind ?? null };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
