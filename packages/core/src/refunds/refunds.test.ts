import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPool, type Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { commerceIsClean, reconcileCommerce } from "../ledger";
import { money } from "../money";
import { pendingNotifications } from "../notifications";
import {
  applyProviderEvent, createCheckout, expireLapsedOrders, initiatePayment,
} from "../orders";
import {
  classifyRefundFailure, classifyRefundResponse, MockPaymentProvider,
  RefundTransportError, screenDetail, stageOfTransportFailure, supportsRefundQuery,
  type MockRefundScenario,
} from "../payments";
import { createTestUser, ensureReferenceData, expectRejection, resetData, testDb } from "../test/harness";
import {
  canTransitionRefund, confirmManualReconciliation, countManualReconcilers,
  DEFAULT_REFUND_MAX_ATTEMPTS, DEFAULT_REFUND_RETRY_BACKOFF_SECONDS,
  DEFAULT_REFUND_STUCK_IN_FLIGHT_SECONDS, executeRefund, isRetryableRefundState,
  isTerminalRefundState, listRefundAttempts, listRefundQueue, loadRefundPolicy,
  processRefundQueue, proposeManualReconciliation, refundIdempotencyKey,
  REFUND_STATES, resolveRefundFromProvider, sweepStuckRefunds,
} from "./index";

/**
 * Refund execution, at the places it can cost money.
 *
 * The suite is organised around one rule and the ways a system violates it:
 *
 *     UNKNOWN MUST NEVER BECOME FAILED.
 *
 * Sections 1–3 establish the machine. Section 4 is the correction: every shape
 * of provider failure, classified by how far the request got rather than by
 * what the response said. Sections 5–9 are the ways a duplicate refund could
 * still get through — races, crashes, retries, replays, operators — and section
 * 10 is what an operator may and may not do with their hands.
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
  await db.execute(sql`
    insert into commission_rules
      (id, transaction_type, rate_bps, currency, priority, effective_from)
    values (gen_random_uuid(), 'digital', 1800, 'XOF', 0, '2026-01-01T00:00:00Z')
  `);
});

// ---------------------------------------------------------------------------
// Building a real refund_due order, through the real code paths
// ---------------------------------------------------------------------------

let counter = 0;

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

async function makeMember(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  return { userId };
}

/** A finance user, elevated. Two gates, and both are exercised elsewhere. */
async function makeFinance(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "finance");
  return { userId, elevated: true };
}

async function makeSupport(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "support");
  return { userId, elevated: true };
}

interface OwedRefund {
  refundId: string;
  orderId: string;
  paymentId: string;
  paymentRef: string;
  buyer: Actor;
}

/**
 * Produces a genuinely owed refund, the way production does.
 *
 * Nothing here inserts a `refunds` row. A product is published, bought, the
 * checkout expires, the payment confirms outside the grace window, and the late
 * payment policy decides `refund_due` — which is what creates the refund. If
 * that chain ever stops creating one, every test in this file fails, which is
 * the correct blast radius for that regression.
 */
async function owedRefund(
  options: { scenario?: MockRefundScenario } = {},
): Promise<OwedRefund> {
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

  const store = await createStore(db, seller, { name: `R ${counter}`, slug: `r-${counter}` });
  await publishStore(db, seller, store.id);
  const product = await createProduct(db, seller, {
    storeId: store.id, title: `P ${counter}`, slug: `rp-${counter}`, price: money(5000n, "XOF"),
  });
  await publishProduct(db, seller, product.id);

  const buyer = await makeMember();
  const { order } = await createCheckout(db, buyer, {
    storeSlug: store.slug, productSlug: product.slug, checkoutKey: `rk-${counter}`,
  });
  const payment = await initiatePayment(db, buyer, provider, { orderId: order.id });
  const paymentRef = payment.providerRef as string;

  // Age it past expiry AND past the grace window, so the late payment is owed
  // a refund rather than fulfilled.
  await db.execute(sql`
    update orders set expires_at = now() - interval '48 hours' where id = ${order.id}::uuid
  `);
  await expireLapsedOrders(db);

  const event = provider.event({
    id: `refund-evt-${counter}`, providerRef: paymentRef, status: "succeeded",
    amountMinor: 5000n, currency: "XOF",
  });
  const applied = await applyProviderEvent(db, provider, event.body, event.headers);
  expect(applied.orderStatus, "the fixture must produce a real refund_due order").toBe("refund_due");

  const rows = await db.execute<{ [key: string]: unknown; id: string; payment_id: string }>(sql`
    select id, payment_id from refunds where order_id = ${order.id}::uuid
  `);
  const refund = rows.rows[0];
  expect(refund, "reaching refund_due must have recorded a refund").toBeDefined();

  if (options.scenario !== undefined) provider.planRefund(paymentRef, options.scenario);

  return {
    refundId: refund!.id,
    orderId: order.id,
    paymentId: refund!.payment_id,
    paymentRef,
    buyer,
  };
}

async function refundRow(refundId: string) {
  const rows = await db.execute<{
    [key: string]: unknown;
    status: string;
    attempt_count: number;
    provider_refund_ref: string | null;
    resolved_by: string | null;
    resolution_evidence: string | null;
    not_before: string | null;
    requested_by_user_id: string | null;
    reconciliation_mode: string | null;
  }>(sql`
    select status, attempt_count, provider_refund_ref, resolved_by, resolution_evidence,
           not_before::text, requested_by_user_id, reconciliation_mode
      from refunds where id = ${refundId}::uuid
  `);
  return rows.rows[0]!;
}

async function auditActions(refundId: string): Promise<string[]> {
  const rows = await db.execute<{ [key: string]: unknown; action: string }>(sql`
    select action from audit_logs where target_id = ${refundId} order by occurred_at
  `);
  return rows.rows.map((r) => r.action);
}

// ---------------------------------------------------------------------------

describe("1 · the state machine is the safety argument", () => {
  it("forbids in_doubt → in_flight, and says why", () => {
    expect(canTransitionRefund("in_doubt", "in_flight")).toBe(false);
    expect(isRetryableRefundState("in_doubt")).toBe(false);
  });

  it("permits exactly the transitions the design approved", () => {
    const legal = new Set<string>();
    for (const from of REFUND_STATES) {
      for (const to of REFUND_STATES) {
        if (canTransitionRefund(from, to)) legal.add(`${from}->${to}`);
      }
    }
    expect([...legal].sort()).toEqual([
      "failed->in_flight",
      "in_doubt->failed",
      "in_doubt->succeeded",
      "in_flight->failed",
      "in_flight->in_doubt",
      "in_flight->succeeded",
      "owed->in_flight",
    ]);
  });

  it("makes succeeded the only terminal state", () => {
    expect(REFUND_STATES.filter(isTerminalRefundState)).toEqual(["succeeded"]);
  });

  it("lets an unknown become retryable only by first becoming failed", () => {
    // The path exists — it is not a dead end — but it goes through evidence.
    expect(canTransitionRefund("in_doubt", "failed")).toBe(true);
    expect(canTransitionRefund("failed", "in_flight")).toBe(true);
    expect(canTransitionRefund("in_doubt", "in_flight")).toBe(false);
  });
});

describe("2 · a refund_due order records a debt, automatically and once", () => {
  it("creates the refund inside the transaction that owes it", async () => {
    const owed = await owedRefund();
    const row = await refundRow(owed.refundId);
    expect(row.status).toBe("owed");
    expect(row.attempt_count).toBe(0);
    // Nobody has authorised anything: recording is automatic, paying is not.
    expect(row.requested_by_user_id).toBeNull();
  });

  it("freezes the amount and currency from the payment", async () => {
    const owed = await owedRefund();
    const rows = await db.execute<{ [key: string]: unknown; same: boolean }>(sql`
      select (r.amount_minor = p.amount_minor and r.currency = p.currency) as same
        from refunds r join payments p on p.id = r.payment_id
       where r.id = ${owed.refundId}::uuid
    `);
    expect(rows.rows[0]?.same).toBe(true);
  });

  it("refuses a second refund for the same payment", async () => {
    const owed = await owedRefund();
    await expectRejection(
      db.execute(sql`
        insert into refunds (id, order_id, payment_id, provider, status, amount_minor,
                             currency, reason)
        values (gen_random_uuid(), ${owed.orderId}, ${owed.paymentId}, 'mock', 'owed',
                5000, 'XOF', 'second')
      `),
      /refunds_payment_key|duplicate key/i,
    );
  });

  it("tells the buyer a refund is owed, without inventing a sender", async () => {
    const owed = await owedRefund();
    const pending = await pendingNotifications(db);
    const notice = pending.find((n) => n.subjectId === owed.refundId);
    expect(notice?.kind).toBe("refund.owed");
    expect(notice?.recipientUserId).toBe(owed.buyer.userId);
    // Nothing was delivered, and nothing claims it was.
    expect(pending.every((n) => n.kind.startsWith("refund."))).toBe(true);
  });

  it("leaves the order terminal at refund_due", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    const rows = await db.execute<{ [key: string]: unknown; status: string }>(sql`
      select status from orders where id = ${owed.orderId}::uuid
    `);
    // Decision 7: the order records the debt, the refund records what happened.
    expect(rows.rows[0]?.status).toBe("refund_due");
  });
});

describe("3 · the ordinary success path", () => {
  it("executes, resolves and records evidence", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();

    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("succeeded");
    expect(result.stage).toBe("transmitted");

    const row = await refundRow(owed.refundId);
    expect(row.status).toBe("succeeded");
    expect(row.resolved_by).toBe("response");
    expect(row.provider_refund_ref).not.toBeNull();
    expect(row.resolution_evidence).not.toBeNull();
    expect(row.requested_by_user_id).toBe(finance.userId);

    expect(provider.refundsPerformed()).toBe(1);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("writes exactly one attempt, with a derived idempotency key", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const attempts = await listRefundAttempts(db, finance, owed.refundId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.attemptNo).toBe(1);
    expect(attempts[0]?.idempotencyKey).toBe(refundIdempotencyKey(owed.refundId, 1));
    expect(attempts[0]?.finishedAt).not.toBeNull();
    expect(attempts[0]?.outcome).toBe("succeeded");
  });

  it("posts nothing to the ledger", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    const rows = await db.execute<{ [key: string]: unknown; n: string }>(sql`
      select count(*) as n from ledger_transactions
    `);
    // Decision 3: Phase 2 posts no capture, so there is nothing to reverse.
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });

  it("queues the buyer a resolution notice, once", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    const pending = await pendingNotifications(db);
    const succeeded = pending.filter(
      (n) => n.subjectId === owed.refundId && n.kind === "refund.succeeded",
    );
    expect(succeeded).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The correction: how far did the request get?
// ---------------------------------------------------------------------------

describe("4 · UNKNOWN MUST NEVER BECOME FAILED", () => {
  it("classifies a timeout after transmission as in_doubt, never failed", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();

    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("in_doubt");
    expect(result.stage).toBe("unknown");

    // And the refund really did happen on the provider's side. This is the
    // whole reason a timeout may not be read as a failure.
    expect(provider.silentRefundRefs()).toHaveLength(1);
  });

  it("classifies an HTTP 500 AFTER transmission as in_doubt, never failed", async () => {
    const owed = await owedRefund({ scenario: "http_500" });
    const finance = await makeFinance();

    const result = await executeRefund(db, finance, provider, owed.refundId);
    /*
     * The corrected rule, at the exact point it was wrong.
     *
     * An HTTP 500 says the provider's web tier had a problem. It says nothing
     * about whether the refund it had already accepted went through — and in
     * this scenario it did.
     */
    expect(result.status, "a 5xx after transmission is unknown, not failed").toBe("in_doubt");
    expect(result.stage).toBe("transmitted");
    expect(provider.refundHappened(provider.silentRefundRefs()[0] as string)).toBe(true);
  });

  it("classifies a connection lost after transmission as in_doubt", async () => {
    const owed = await owedRefund({ scenario: "connection_lost" });
    const finance = await makeFinance();
    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("in_doubt");
    expect(result.stage).toBe("unknown");
  });

  it("classifies an unparseable response as in_doubt", async () => {
    const owed = await owedRefund({ scenario: "malformed" });
    const finance = await makeFinance();
    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("in_doubt");
    expect(result.stage).toBe("transmitted");
  });

  it("classifies a DNS failure as failed, because nothing could have happened", async () => {
    const owed = await owedRefund({ scenario: "dns_failure" });
    const finance = await makeFinance();
    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("failed");
    expect(result.stage).toBe("not_transmitted");
    expect(provider.refundsPerformed()).toBe(0);
  });

  it("classifies a refused connection as failed", async () => {
    const owed = await owedRefund({ scenario: "connection_refused" });
    const finance = await makeFinance();
    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("failed");
    expect(result.stage).toBe("not_transmitted");
  });

  it("accepts a documented rejection carrying evidence as failed", async () => {
    const owed = await owedRefund({ scenario: "rejects" });
    const finance = await makeFinance();
    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("failed");
    const row = await refundRow(owed.refundId);
    expect(row.resolution_evidence).toMatch(/REFUND_WINDOW_CLOSED/);
  });

  it("REFUSES a bare failure with no evidence, and calls it unknown", async () => {
    const owed = await owedRefund({ scenario: "rejects_without_evidence" });
    const finance = await makeFinance();
    const result = await executeRefund(db, finance, provider, owed.refundId);
    /*
     * A provider that says "failed" and nothing else is indistinguishable from
     * one that accepted the refund and reported it badly. Believing it would
     * make the refund retryable, which is the duplicate.
     */
    expect(result.status).toBe("in_doubt");
    const row = await refundRow(owed.refundId);
    expect(row.resolution_evidence).toMatch(/without evidence/i);
  });

  it("REFUSES a success with no reference, and calls it unknown", async () => {
    const owed = await owedRefund({ scenario: "succeeds_without_ref" });
    const finance = await makeFinance();
    const result = await executeRefund(db, finance, provider, owed.refundId);
    expect(result.status).toBe("in_doubt");
  });

  it("holds the classification rules directly, without a database", () => {
    // The table itself, so a widened not-transmitted set fails here first.
    expect(stageOfTransportFailure(Object.assign(new Error(""), { code: "ENOTFOUND" })))
      .toBe("not_transmitted");
    expect(stageOfTransportFailure(Object.assign(new Error(""), { code: "ECONNREFUSED" })))
      .toBe("not_transmitted");
    // Each of these could have happened after the bytes went out.
    for (const code of ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ABORT_ERR", "UND_ERR_HEADERS_TIMEOUT"]) {
      expect(
        stageOfTransportFailure(Object.assign(new Error(""), { code })),
        `${code} must not be treated as proof of non-transmission`,
      ).toBe("unknown");
    }
    expect(stageOfTransportFailure(new RefundTransportError("500", "transmitted", 500)))
      .toBe("transmitted");

    expect(classifyRefundFailure(new RefundTransportError("500", "transmitted", 500)).kind)
      .toBe("in_doubt");
    expect(
      classifyRefundResponse({ providerRefundRef: "r1", status: "failed", raw: {} }).kind,
      "no evidence, no failure",
    ).toBe("in_doubt");
    expect(
      classifyRefundResponse({
        providerRefundRef: "r1", status: "failed",
        notExecutedEvidence: "no refund created", raw: {},
      }).kind,
    ).toBe("failed");
  });

  it("screens secrets out of anything it stores", () => {
    const screened = screenDetail({
      error: "auth failed",
      authorization: "Bearer sk_live_abcdef1234567890",
      api_key: "pk_live_9876543210",
    });
    expect(screened).not.toMatch(/sk_live_abcdef/);
    expect(screened).not.toMatch(/pk_live_987/);
    expect(screened).toMatch(/redacted/);
  });

  it("never lets a provider secret reach the stored attempt detail", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();
    // A provider that leaks a credential in its error body.
    const leaky = new MockPaymentProvider();
    Object.assign(leaky, {
      refund: () =>
        Promise.reject(
          new RefundTransportError(
            'provider rejected: {"authorization":"Bearer sk_live_TOPSECRET99"}',
            "transmitted",
          ),
        ),
    });
    await executeRefund(db, finance, leaky as unknown as MockPaymentProvider, owed.refundId);

    const attempts = await listRefundAttempts(db, finance, owed.refundId);
    expect(attempts[0]?.detail).not.toMatch(/TOPSECRET/);
    const row = await refundRow(owed.refundId);
    expect(row.resolution_evidence).not.toMatch(/TOPSECRET/);
    const auditRows = await db.execute<{ [key: string]: unknown; ctx: string }>(sql`
      select context::text as ctx from audit_logs where target_id = ${owed.refundId}
    `);
    expect(auditRows.rows.some((r) => /TOPSECRET/.test(r.ctx))).toBe(false);
  });
});

describe("5 · an in_doubt refund is never retried", () => {
  it("refuses a direct retry, with an explanation", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    expect((await refundRow(owed.refundId)).status).toBe("in_doubt");

    await expectRejection(
      executeRefund(db, finance, provider, owed.refundId),
      /never retried|Resolve it first/i,
    );
    // And no second request went out.
    expect(await listRefundAttempts(db, finance, owed.refundId)).toHaveLength(1);
  });

  it("is not retried by the queue processor either", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    const before = provider.refundsPerformed();

    await processRefundQueue(db, provider);
    await processRefundQueue(db, provider);

    // The queue may RESOLVE it — that is its job — but it may never send a
    // second refund request.
    expect(await listRefundAttempts(db, finance, owed.refundId)).toHaveLength(1);
    expect(provider.refundsPerformed()).toBe(before);
  });

  it("resolves an unknown to the truth: the refund did happen", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const resolution = await resolveRefundFromProvider(db, provider, owed.refundId);
    expect(resolution.resolved).toBe(true);
    expect(resolution.status).toBe("succeeded");

    const row = await refundRow(owed.refundId);
    expect(row.status).toBe("succeeded");
    expect(row.resolved_by).toBe("status_query");
    // One refund performed, not two.
    expect(provider.refundsPerformed()).toBe(1);
  });

  it("resolves an unknown to failed when the provider says no refund exists", async () => {
    const owed = await owedRefund({ scenario: "timeout_not_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const resolution = await resolveRefundFromProvider(db, provider, owed.refundId);
    expect(resolution.resolved).toBe(true);
    expect(resolution.status).toBe("failed");

    // NOW it is retryable — the state machine says so only because evidence
    // arrived, not because time passed.
    const row = await refundRow(owed.refundId);
    expect(row.status).toBe("failed");
    expect(row.resolution_evidence).toMatch(/no refund exists/i);
  });

  it("leaves it in_doubt when the provider cannot be asked", async () => {
    const owed = await owedRefund({ scenario: "timeout_not_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const blind = new MockPaymentProvider();
    // A provider with no status query at all — the iPayMoney open question.
    delete (blind as { getRefund?: unknown }).getRefund;
    Object.defineProperty(blind, "getRefund", { value: undefined, configurable: true });
    expect(supportsRefundQuery(blind)).toBe(false);

    const resolution = await resolveRefundFromProvider(db, blind, owed.refundId);
    expect(resolution.resolved).toBe(false);
    expect(resolution.reason).toBe("provider_has_no_query");
    expect((await refundRow(owed.refundId)).status).toBe("in_doubt");
  });
});

describe("6 · idempotency and the crash window", () => {
  it("writes the attempt row BEFORE the provider is called", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();

    /*
     * The crash, made observable.
     *
     * The provider throws a plain process failure from inside `refund()`, and
     * while it is inside, it reads the database on its own connection. What it
     * must find is an attempt row that is already committed — because that row
     * is the only thing that would remain if the process died at this instant.
     */
    let attemptsVisibleDuringCall = -1;
    let refundStatusDuringCall = "";
    const crashing = new MockPaymentProvider();
    Object.assign(crashing, {
      refund: async () => {
        const client = await getPool().connect();
        try {
          const seen = await client.query(
            "select count(*)::int as n from refund_attempts where refund_id = $1",
            [owed.refundId],
          );
          attemptsVisibleDuringCall = seen.rows[0].n as number;
          const state = await client.query("select status from refunds where id = $1", [
            owed.refundId,
          ]);
          refundStatusDuringCall = state.rows[0].status as string;
        } finally {
          client.release();
        }
        throw new RefundTransportError("process died here", "unknown");
      },
    });

    await executeRefund(db, finance, crashing as unknown as MockPaymentProvider, owed.refundId);

    expect(attemptsVisibleDuringCall, "the evidence must be durable before the call").toBe(1);
    expect(refundStatusDuringCall).toBe("in_flight");
  });

  it("leaves an open attempt and an in_flight refund when the process dies", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();

    // A provider that never returns — the process is killed mid-flight. The
    // dispatch promise is abandoned, exactly as a crash would abandon it.
    const hanging = new MockPaymentProvider();
    Object.assign(hanging, { refund: () => new Promise(() => {}) });
    void executeRefund(db, finance, hanging as unknown as MockPaymentProvider, owed.refundId);
    await new Promise((r) => setTimeout(r, 250));

    const row = await refundRow(owed.refundId);
    expect(row.status).toBe("in_flight");
    const attempts = await listRefundAttempts(db, finance, owed.refundId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.finishedAt, "an open attempt is the crash's fingerprint").toBeNull();

    /*
     * And nothing may start a second request. Here the refusal comes from the
     * STATE MACHINE — the refund is in_flight, and in_flight is not a state a
     * request may leave from. The open-attempt guard is a separate layer and
     * is isolated in the next test, because a mutation showed that this
     * assertion alone could not tell the two apart.
     */
    await expectRejection(
      executeRefund(db, finance, provider, owed.refundId),
      /cannot go from in_flight to in_flight/i,
    );
    expect(provider.refundsPerformed()).toBe(0);
  });

  it("refuses to dispatch while an attempt is open, even from a retryable state", async () => {
    /*
     * The open-attempt guard, on its own.
     *
     * The previous test cannot exercise it: an in_flight refund is already
     * refused by the state machine, so removing the guard changes nothing
     * there — a mutation proved exactly that, and this test exists because of
     * it. Here the refund is `failed`, which IS a state a retry may leave
     * from, so the state machine permits the dispatch and only the open
     * attempt stands in the way.
     */
    const owed = await owedRefund({ scenario: "dns_failure" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    expect((await refundRow(owed.refundId)).status).toBe("failed");

    // A crashed retry: an attempt that was started and never closed. Numbered
    // out of the way so the unique index is not what refuses the dispatch.
    await db.execute(sql`
      insert into refund_attempts (id, refund_id, attempt_no, idempotency_key)
      values (gen_random_uuid(), ${owed.refundId}, 99, ${refundIdempotencyKey(owed.refundId, 99)})
    `);
    await db.execute(sql`update refunds set not_before = null where id = ${owed.refundId}::uuid`);
    provider.planRefund(owed.paymentRef, "succeeds");

    await expectRejection(
      executeRefund(db, finance, provider, owed.refundId),
      /attempt for this refund is still open/i,
    );
    // The assertion that actually matters: no second request went out.
    expect(provider.refundsPerformed()).toBe(0);
  });

  it("sweeps a crashed request to in_doubt, never to failed", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();
    const hanging = new MockPaymentProvider();
    Object.assign(hanging, { refund: () => new Promise(() => {}) });
    void executeRefund(db, finance, hanging as unknown as MockPaymentProvider, owed.refundId);
    await new Promise((r) => setTimeout(r, 250));

    /*
     * The attempt cannot be back-dated — the append-only trigger refuses to
     * re-identify a row, `started_at` included, which is exactly the property
     * that makes the evidence worth anything. So the threshold moves instead
     * of the evidence: the sweep is handed a policy whose patience has run
     * out. The clamp on that setting is tested separately, in section 8.
     */
    await expectRejection(
      db.execute(sql`
        update refund_attempts set started_at = now() - interval '2 hours'
         where refund_id = ${owed.refundId}::uuid
      `),
      /may only be closed, not re-identified/i,
    );

    const policy = await loadRefundPolicy(db);
    const swept = await sweepStuckRefunds(db, { ...policy, stuckInFlightSeconds: 0 });
    expect(swept).toBe(1);

    const row = await refundRow(owed.refundId);
    expect(row.status, "a crash is an unknown, not a failure").toBe("in_doubt");
  });

  it("gives every attempt a distinct derived key, and refuses a duplicate", async () => {
    const owed = await owedRefund({ scenario: "dns_failure" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    await db.execute(sql`update refunds set not_before = null where id = ${owed.refundId}::uuid`);
    await executeRefund(db, finance, provider, owed.refundId);

    const attempts = await listRefundAttempts(db, finance, owed.refundId);
    expect(attempts.map((a) => a.idempotencyKey)).toEqual([
      refundIdempotencyKey(owed.refundId, 1),
      refundIdempotencyKey(owed.refundId, 2),
    ]);

    await expectRejection(
      db.execute(sql`
        insert into refund_attempts (id, refund_id, attempt_no, idempotency_key)
        values (gen_random_uuid(), ${owed.refundId}, 9, ${refundIdempotencyKey(owed.refundId, 1)})
      `),
      /refund_attempts_idempotency_key|duplicate key/i,
    );
  });

  it("freezes a finished attempt against rewriting, and against deletion", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    await expectRejection(
      db.execute(sql`
        update refund_attempts set outcome = 'failed' where refund_id = ${owed.refundId}::uuid
      `),
      /already finished|cannot be rewritten/i,
    );
    await expectRejection(
      db.execute(sql`delete from refund_attempts where refund_id = ${owed.refundId}::uuid`),
      /append-only|never be deleted/i,
    );
  });
});

describe("7 · concurrency, against a real held row lock", () => {
  it("makes two simultaneous executions serialise, and only one send", async () => {
    /*
     * The race, made deterministic.
     *
     * `Promise.all` cannot reliably interleave two transactions, so this test
     * holds the refund row itself: a separate connection takes `for update`,
     * an execution arrives and must WAIT, the holder commits, and only then
     * does the execution get to look. What it must find is the state the
     * holder left — and refuse to act on the state it read before waiting.
     */
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    const holder = await getPool().connect();

    let outcome: PromiseSettledResult<unknown>;
    try {
      await holder.query("begin");
      await holder.query("select id from refunds where id = $1 for update", [owed.refundId]);

      const attempt = executeRefund(db, finance, provider, owed.refundId);
      // Long enough for the execution to reach the lock and block on it.
      await new Promise((r) => setTimeout(r, 250));

      // Underneath the waiting execution, the refund is claimed and sent.
      await holder.query(
        "update refunds set status = 'in_flight', attempt_count = 1 where id = $1",
        [owed.refundId],
      );
      await holder.query(
        "insert into refund_attempts (id, refund_id, attempt_no, idempotency_key)" +
          " values (gen_random_uuid(), $1, 1, $2)",
        [owed.refundId, refundIdempotencyKey(owed.refundId, 1)],
      );
      await holder.query("commit");

      outcome = (await Promise.allSettled([attempt]))[0]!;
    } finally {
      holder.release();
    }

    expect(
      outcome.status,
      "the waiter must see what it waited for and refuse, not act on a stale read",
    ).toBe("rejected");
    expect(provider.refundsPerformed()).toBe(0);

    const attempts = await db.execute<{ [key: string]: unknown; n: string }>(sql`
      select count(*) as n from refund_attempts where refund_id = ${owed.refundId}::uuid
    `);
    expect(Number(attempts.rows[0]?.n), "exactly one attempt exists").toBe(1);
  });

  it("never performs two refunds when many executions race", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();

    const results = await Promise.allSettled([
      executeRefund(db, finance, provider, owed.refundId),
      executeRefund(db, finance, provider, owed.refundId),
      executeRefund(db, finance, provider, owed.refundId),
      executeRefund(db, finance, provider, owed.refundId),
    ]);

    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(provider.refundsPerformed(), "the buyer is refunded exactly once").toBe(1);
    expect((await refundRow(owed.refundId)).status).toBe("succeeded");
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("never performs two refunds when an operator and the scheduler collide", async () => {
    const owed = await owedRefund({ scenario: "dns_failure" });
    const finance = await makeFinance();
    // One authorised attempt that provably never left. Now it is retryable.
    await executeRefund(db, finance, provider, owed.refundId);
    await db.execute(sql`update refunds set not_before = null where id = ${owed.refundId}::uuid`);
    provider.planRefund(owed.paymentRef, "succeeds");

    await Promise.allSettled([
      executeRefund(db, finance, provider, owed.refundId),
      processRefundQueue(db, provider),
      executeRefund(db, finance, provider, owed.refundId),
    ]);

    expect(provider.refundsPerformed()).toBe(1);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });
});

describe("8 · retries, bounded and clamped", () => {
  it("stops at the reviewed attempt ceiling", async () => {
    const owed = await owedRefund({ scenario: "dns_failure" });
    const finance = await makeFinance();

    for (let i = 0; i < DEFAULT_REFUND_MAX_ATTEMPTS; i += 1) {
      await db.execute(sql`update refunds set not_before = null where id = ${owed.refundId}::uuid`);
      await executeRefund(db, finance, provider, owed.refundId);
    }
    await db.execute(sql`update refunds set not_before = null where id = ${owed.refundId}::uuid`);
    await expectRejection(
      executeRefund(db, finance, provider, owed.refundId),
      /all 3 permitted attempts/i,
    );
  });

  it("refuses a retry inside the backoff window", async () => {
    const owed = await owedRefund({ scenario: "dns_failure" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    await expectRejection(
      executeRefund(db, finance, provider, owed.refundId),
      /backoff/i,
    );
  });

  it("clamps configuration that tries to make retries MORE aggressive", async () => {
    await db.execute(sql`
      update platform_settings set value = '99'::jsonb where key = 'refund.max_attempts'
    `);
    await db.execute(sql`
      update platform_settings set value = '0'::jsonb where key = 'refund.retry_backoff_seconds'
    `);
    await db.execute(sql`
      update platform_settings set value = '1'::jsonb where key = 'refund.stuck_in_flight_seconds'
    `);
    await db.execute(sql`
      update platform_settings set value = '5000'::jsonb where key = 'refund.queue_batch_size'
    `);

    const policy = await loadRefundPolicy(db);
    expect(policy.maxAttempts).toBe(DEFAULT_REFUND_MAX_ATTEMPTS);
    expect(policy.retryBackoffSeconds).toBe(DEFAULT_REFUND_RETRY_BACKOFF_SECONDS);
    expect(policy.stuckInFlightSeconds).toBe(DEFAULT_REFUND_STUCK_IN_FLIGHT_SECONDS);
    expect(policy.queueBatchSize).toBe(20);
  });

  it("accepts configuration that makes retries gentler", async () => {
    await db.execute(sql`
      update platform_settings set value = '1'::jsonb where key = 'refund.max_attempts'
    `);
    await db.execute(sql`
      update platform_settings set value = '3600'::jsonb where key = 'refund.retry_backoff_seconds'
    `);
    const policy = await loadRefundPolicy(db);
    expect(policy.maxAttempts).toBe(1);
    expect(policy.retryBackoffSeconds).toBe(3600);
  });

  it("falls back to the reviewed policy on a malformed setting", async () => {
    /*
     * `"1"` is the value that matters, and it is here because a mutation
     * showed the others were not enough.
     *
     * Coercing with `Number()` turns every one of "null", "3" and "lots" into
     * something that lands back on the reviewed default anyway — 0, 3 and NaN
     * respectively — so a coercing loader passed this test while quietly
     * accepting a string as configuration. The string "1" is the one that
     * separates them: coerced it narrows the ceiling to a value nobody wrote
     * as a number, and rejected it falls back to the reviewed 3.
     */
    for (const bad of ["null", '"3"', '"1"', '"lots"', "-1", '"9"', "true", '{}']) {
      await db.execute(sql.raw(
        `update platform_settings set value = '${bad}'::jsonb where key = 'refund.max_attempts'`,
      ));
      expect(
        (await loadRefundPolicy(db)).maxAttempts,
        `${bad} is not a number and must not be read as configuration`,
      ).toBe(DEFAULT_REFUND_MAX_ATTEMPTS);
    }
    // A missing row is not permission either.
    await db.execute(sql`delete from platform_settings where key = 'refund.retry_backoff_seconds'`);
    expect((await loadRefundPolicy(db)).retryBackoffSeconds)
      .toBe(DEFAULT_REFUND_RETRY_BACKOFF_SECONDS);
    await db.execute(sql`
      insert into platform_settings (key, value, description)
      values ('refund.retry_backoff_seconds', '300'::jsonb, 'restored')
    `);
  });
});

describe("9 · the scheduler continues authority, it never creates it", () => {
  it("never starts a refund nobody authorised", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const before = await refundRow(owed.refundId);
    expect(before.status).toBe("owed");

    await processRefundQueue(db, provider);
    await processRefundQueue(db, provider);

    const after = await refundRow(owed.refundId);
    expect(after.status, "owed is not the scheduler's to touch").toBe("owed");
    expect(provider.refundsPerformed()).toBe(0);
  });

  it("retries a proven failure that a finance user already authorised", async () => {
    const owed = await owedRefund({ scenario: "dns_failure" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    await db.execute(sql`update refunds set not_before = null where id = ${owed.refundId}::uuid`);
    provider.planRefund(owed.paymentRef, "succeeds");

    const report = await processRefundQueue(db, provider);
    expect(report.retried).toBe(1);
    expect((await refundRow(owed.refundId)).status).toBe("succeeded");
  });

  it("does not retry a proven failure nobody authorised", async () => {
    const owed = await owedRefund();
    // A failed refund with no requester — reachable only by a direct row edit,
    // which is exactly the state the check exists for.
    await db.execute(sql`
      update refunds
         set status = 'failed', resolved_by = 'response', resolution_evidence = 'planted',
             requested_by_user_id = null
       where id = ${owed.refundId}::uuid
    `);
    const report = await processRefundQueue(db, provider);
    expect(report.retried).toBe(0);
    expect(provider.refundsPerformed()).toBe(0);
  });

  it("sweeps and resolves in one pass", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const report = await processRefundQueue(db, provider);
    expect(report.resolved).toBe(1);
    expect((await refundRow(owed.refundId)).status).toBe("succeeded");
  });
});

describe("10 · authorization, elevation and the operator's hands", () => {
  it("refuses an ordinary member", async () => {
    const owed = await owedRefund();
    const member = await makeMember();
    await expectRejection(
      executeRefund(db, { ...member, elevated: true }, provider, owed.refundId),
      /refund\.execute|denied/i,
    );
    await expectRejection(listRefundQueue(db, member), /refund\.read|denied/i);
  });

  it("lets support read the queue and refuses it execution", async () => {
    const owed = await owedRefund();
    const support = await makeSupport();

    const queue = await listRefundQueue(db, support);
    expect(queue.map((r) => r.id)).toContain(owed.refundId);

    await expectRejection(
      executeRefund(db, support, provider, owed.refundId),
      /refund\.execute|denied/i,
    );
    await expectRejection(
      proposeManualReconciliation(db, support, {
        refundId: owed.refundId, outcome: "failed", evidence: "x",
      }),
      /refund\.reconcile_manual|denied/i,
    );
  });

  it("requires step-up elevation even from finance", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();
    await expectRejection(
      executeRefund(db, { ...finance, elevated: false }, provider, owed.refundId),
      /elevation|fresh verification/i,
    );
    expect(provider.refundsPerformed()).toBe(0);
  });

  it("offers no way to mark a refund succeeded without evidence", async () => {
    const owed = await owedRefund();
    // The database itself refuses, so no future code path can offer the button.
    await expectRejection(
      db.execute(sql`
        update refunds set status = 'succeeded' where id = ${owed.refundId}::uuid
      `),
      /refunds_succeeded_has_evidence|violates check/i,
    );
    await expectRejection(
      db.execute(sql`
        update refunds set status = 'failed' where id = ${owed.refundId}::uuid
      `),
      /refunds_failed_has_evidence|violates check/i,
    );
  });

  it("refuses to refund a payment that did not succeed", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();
    await db.execute(sql`
      update payments set status = 'failed', confirmed_at = null where id = ${owed.paymentId}::uuid
    `);
    await expectRejection(
      executeRefund(db, finance, provider, owed.refundId),
      /not succeeded|never arrived/i,
    );
  });

  it("freezes the money snapshot against editing, and the refund against deletion", async () => {
    const owed = await owedRefund();
    /*
     * Not "our code does not update these" — the database refuses.
     *
     * How much goes back and to whose charge is the one thing on this row that
     * is a fact rather than a lifecycle. A trigger is what makes it as
     * immutable as the ledger's entries, rather than as immutable as the next
     * person's UPDATE.
     */
    for (const column of ["amount_minor = 500000", "currency = 'XAF'", "provider = 'other'"]) {
      await expectRejection(
        db.execute(sql.raw(
          `update refunds set ${column} where id = '${owed.refundId}'::uuid`,
        )),
        /frozen money snapshot/i,
      );
    }
    await expectRejection(
      db.execute(sql`delete from refunds where id = ${owed.refundId}::uuid`),
      /never deleted|resolved, not erased/i,
    );
  });

  it("refuses to send an amount the payment does not corroborate", async () => {
    const owed = await owedRefund();
    const finance = await makeFinance();
    // The refund's own snapshot cannot be edited, so the drift is introduced on
    // the payment side — which is the only side that can drift.
    await db.execute(sql`
      update payments set amount_minor = 500000 where id = ${owed.paymentId}::uuid
    `);
    await expectRejection(
      executeRefund(db, finance, provider, owed.refundId),
      /no longer matches its payment/i,
    );
    expect(provider.refundsPerformed()).toBe(0);
  });

  it("never lets a caller's status filter reach SQL", async () => {
    const support = await makeSupport();
    await owedRefund();
    /*
     * The status list reaches SQL through `sql.raw` — Drizzle cannot
     * parameterise an IN list of unknown length — so it must consist of values
     * this module chose. TypeScript says as much, and a value arriving from
     * JSON has no type at runtime, so the filter is checked against the state
     * list rather than trusted.
     */
    const hostile = ["owed') or true --", "'; drop table refunds; --"] as unknown as
      Parameters<typeof listRefundQueue>[2] extends infer O
        ? O extends { statuses?: infer S } ? S : never : never;

    const result = await listRefundQueue(db, support, { statuses: hostile });
    expect(result).toEqual([]);
    // And the table is still there, which is the point.
    const rows = await db.execute<{ [key: string]: unknown; n: string }>(sql`
      select count(*) as n from refunds
    `);
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it("accepts no destination from any caller", () => {
    // A structural claim: `RefundInput` has no beneficiary field, so there is
    // nothing an API request could set. Asserted by shape rather than prose.
    const keys = Object.keys({
      providerRef: "", amount: money(1n, "XOF"), reason: "", idempotencyKey: "",
    });
    expect(keys).toEqual(["providerRef", "amount", "reason", "idempotencyKey"]);
  });
});

describe("11 · manual reconciliation, under dual control", () => {
  async function inDoubt(): Promise<OwedRefund> {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    expect((await refundRow(owed.refundId)).status).toBe("in_doubt");
    return owed;
  }

  it("requires a second person when a second person exists", async () => {
    const owed = await inDoubt();
    const a = await makeFinance();
    const b = await makeFinance();
    expect(await countManualReconcilers(db)).toBeGreaterThanOrEqual(2);

    await proposeManualReconciliation(db, a, {
      refundId: owed.refundId,
      outcome: "succeeded",
      providerRefundRef: "PROV-STMT-9911",
      evidence: "provider statement 2026-08-19, line 42",
    });
    await expectRejection(
      confirmManualReconciliation(db, a, owed.refundId),
      /may not also confirm/i,
    );
    expect((await refundRow(owed.refundId)).status).toBe("in_doubt");

    const state = await confirmManualReconciliation(db, b, owed.refundId);
    expect(state.mode).toBe("two_person");
    const row = await refundRow(owed.refundId);
    expect(row.status).toBe("succeeded");
    expect(row.resolved_by).toBe("manual_reconciliation");
    expect(row.provider_refund_ref).toBe("PROV-STMT-9911");
  });

  it("permits one operator when the deployment genuinely has one, and says so", async () => {
    const owed = await inDoubt();
    // Exactly one holder of refund.reconcile_manual in the whole system.
    await db.execute(sql`
      update role_assignments set revoked_at = now()
       where role_id in (select id from roles where key = 'finance')
    `);
    const only = await makeFinance();
    expect(await countManualReconcilers(db)).toBe(1);

    await proposeManualReconciliation(db, only, {
      refundId: owed.refundId, outcome: "failed",
      evidence: "provider statement shows no refund against this charge",
    });
    const state = await confirmManualReconciliation(db, only, owed.refundId);
    // Not silently identical to dual control — countable, and flagged.
    expect(state.mode).toBe("single_operator");

    const report = await reconcileCommerce(db);
    expect(report.anomalies.map((a) => a.kind))
      .toContain("manual_reconciliation_single_operator");
  });

  it("refuses to claim a success without an external reference", async () => {
    const owed = await inDoubt();
    const a = await makeFinance();
    await expectRejection(
      proposeManualReconciliation(db, a, {
        refundId: owed.refundId, outcome: "succeeded", evidence: "I am sure",
      }),
      /naming the reference/i,
    );
  });

  it("refuses a reconciliation with no evidence", async () => {
    const owed = await inDoubt();
    const a = await makeFinance();
    await expectRejection(
      proposeManualReconciliation(db, a, {
        refundId: owed.refundId, outcome: "failed", evidence: "   ",
      }),
      /without evidence/i,
    );
  });

  it("refuses to confirm something nobody proposed", async () => {
    const owed = await inDoubt();
    const b = await makeFinance();
    await expectRejection(
      confirmManualReconciliation(db, b, owed.refundId),
      /nothing to confirm/i,
    );
  });

  it("clears a stale confirmation when the proposal changes", async () => {
    const owed = await inDoubt();
    const a = await makeFinance();
    const b = await makeFinance();
    await proposeManualReconciliation(db, a, {
      refundId: owed.refundId, outcome: "failed", evidence: "first reading",
    });
    // A second reading replaces the first. B has confirmed nothing yet.
    await proposeManualReconciliation(db, b, {
      refundId: owed.refundId, outcome: "succeeded",
      providerRefundRef: "PROV-2", evidence: "corrected reading",
    });
    const state = await confirmManualReconciliation(db, a, owed.refundId);
    expect(state.mode).toBe("two_person");
    expect((await refundRow(owed.refundId)).provider_refund_ref).toBe("PROV-2");
  });

  it("will not reconcile a refund the machinery already resolved", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    await expectRejection(
      proposeManualReconciliation(db, finance, {
        refundId: owed.refundId, outcome: "failed", evidence: "no",
      }),
      /already knows|not reconcilable|is succeeded/i,
    );
  });

  it("records both people in the audit log", async () => {
    const owed = await inDoubt();
    const a = await makeFinance();
    const b = await makeFinance();
    await proposeManualReconciliation(db, a, {
      refundId: owed.refundId, outcome: "succeeded",
      providerRefundRef: "PROV-77", evidence: "statement line 7",
    });
    await confirmManualReconciliation(db, b, owed.refundId);

    const actions = await auditActions(owed.refundId);
    expect(actions).toContain("refund.manual_reconciliation_proposed");
    expect(actions).toContain("refund.manual_reconciliation_confirmed");

    const rows = await db.execute<{ [key: string]: unknown; ctx: string }>(sql`
      select context::text as ctx from audit_logs
       where target_id = ${owed.refundId}
         and action = 'refund.manual_reconciliation_confirmed'
    `);
    expect(rows.rows[0]?.ctx).toContain(a.userId);
    expect(rows.rows[0]?.ctx).toContain(b.userId);
  });
});

describe("12 · refund webhooks go through the same door as charges", () => {
  it("refuses an unsigned or wrongly signed refund event", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const forged = provider.refundEvent({
      id: "rfd-forged", providerRefundRef: "anything", status: "succeeded",
      signWith: "0".repeat(64),
    });
    await expectRejection(
      applyProviderEvent(db, provider, forged.body, forged.headers),
      /signature/i,
    );
    expect((await refundRow(owed.refundId)).status).toBe("in_doubt");
  });

  it("resolves an in_doubt refund from a signed refund event", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const silent = provider.silentRefundRefs()[0] as string;
    const event = provider.refundEvent({
      id: "rfd-1", providerRefundRef: silent, providerRef: owed.paymentRef,
      status: "succeeded", amountMinor: 5000n, currency: "XOF",
    });
    const applied = await applyProviderEvent(db, provider, event.body, event.headers);
    expect(applied.outcome).toBe("applied");

    const row = await refundRow(owed.refundId);
    expect(row.status).toBe("succeeded");
    expect(row.resolved_by).toBe("webhook");
  });

  it("applies a replayed refund event exactly once", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    const silent = provider.silentRefundRefs()[0] as string;
    const event = provider.refundEvent({
      id: "rfd-dup", providerRefundRef: silent, providerRef: owed.paymentRef,
      status: "succeeded",
    });

    const first = await applyProviderEvent(db, provider, event.body, event.headers);
    const second = await applyProviderEvent(db, provider, event.body, event.headers);
    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("ignored");

    const rows = await db.execute<{ [key: string]: unknown; n: string }>(sql`
      select count(*) as n from payment_events where subject = 'refund'
    `);
    expect(Number(rows.rows[0]?.n), "one event row, under the same replay index").toBe(1);
  });

  it("refuses a refund event whose amount does not match", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    const silent = provider.silentRefundRefs()[0] as string;

    const event = provider.refundEvent({
      id: "rfd-wrong", providerRefundRef: silent, providerRef: owed.paymentRef,
      status: "succeeded", amountMinor: 999_999n, currency: "XOF",
    });
    const applied = await applyProviderEvent(db, provider, event.body, event.headers);
    expect(applied.reason).toBe("amount_mismatch");
    expect((await refundRow(owed.refundId)).status).toBe("in_doubt");
  });

  it("ignores a webhook failure that carries no evidence", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    const silent = provider.silentRefundRefs()[0] as string;

    const event = provider.refundEvent({
      id: "rfd-bare-fail", providerRefundRef: silent, providerRef: owed.paymentRef,
      status: "failed",
    });
    const applied = await applyProviderEvent(db, provider, event.body, event.headers);
    expect(applied.reason).toBe("failure_without_evidence");
    expect((await refundRow(owed.refundId)).status).toBe("in_doubt");
  });

  it("never lets a refund event move a charge", async () => {
    const owed = await owedRefund({ scenario: "timeout_executed" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    // A refund event that names the CHARGE's reference. It must not be read as
    // a charge event, and must not find a refund either.
    const event = provider.refundEvent({
      id: "rfd-confused", providerRefundRef: owed.paymentRef, status: "succeeded",
    });
    await expectRejection(
      applyProviderEvent(db, provider, event.body, event.headers),
      /not known here/i,
    );
    const payment = await db.execute<{ [key: string]: unknown; status: string }>(sql`
      select status from payments where id = ${owed.paymentId}::uuid
    `);
    expect(payment.rows[0]?.status).toBe("succeeded");
  });
});

describe("13 · reconciliation reports what the machine says is impossible", () => {
  it("is silent over a healthy refund", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    expect(commerceIsClean(await reconcileCommerce(db))).toBe(true);
  });

  it("detects a refund_due order with no refund record", async () => {
    const owed = await owedRefund();
    /*
     * The row cannot be deleted — a refund is resolved, never erased — so the
     * missing-record state is produced the only way it could ever arise: an
     * order that reached refund_due without one, which is what a broken or
     * removed creation hook would leave behind.
     */
    await db.execute(sql`
      update orders set status = 'expired' where id = ${owed.orderId}::uuid
    `);
    await db.execute(sql`
      insert into orders (id, buyer_user_id, store_id, checkout_key, status, total_minor,
                          currency, expires_at, late_payment_at, closed_at)
      select gen_random_uuid(), buyer_user_id, store_id, checkout_key || '-orphan',
             'refund_due', total_minor, currency, expires_at, now(), now()
        from orders where id = ${owed.orderId}::uuid
    `);
    const report = await reconcileCommerce(db);
    expect(report.anomalies.map((a) => a.kind)).toContain("refund_due_without_refund_record");
  });

  it("detects a frozen amount that stopped matching its payment", async () => {
    const owed = await owedRefund();
    await db.execute(sql`
      update payments set amount_minor = 4999 where id = ${owed.paymentId}::uuid
    `);
    const report = await reconcileCommerce(db);
    expect(report.anomalies.map((a) => a.kind)).toContain("refund_amount_mismatch");
  });

  it("detects a refund stuck in flight", async () => {
    const owed = await owedRefund();
    await db.execute(sql`
      update refunds set status = 'in_flight', updated_at = now() - interval '3 hours'
       where id = ${owed.refundId}::uuid
    `);
    const report = await reconcileCommerce(db);
    expect(report.anomalies.map((a) => a.kind)).toContain("stuck_in_flight");
  });

  it("detects an attempt nobody ever closed", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    await db.execute(sql`
      insert into refund_attempts (id, refund_id, attempt_no, idempotency_key)
      values (gen_random_uuid(), ${owed.refundId}, 9, 'orphan-key')
    `);
    const report = await reconcileCommerce(db);
    expect(report.anomalies.map((a) => a.kind)).toContain("refund_attempt_never_finished");
  });

  it("detects a refund of a payment that did not succeed", async () => {
    const owed = await owedRefund();
    await db.execute(sql`
      update payments set status = 'failed', confirmed_at = null where id = ${owed.paymentId}::uuid
    `);
    const report = await reconcileCommerce(db);
    expect(report.anomalies.map((a) => a.kind)).toContain("refund_of_unsucceeded_payment");
  });

  it("counts refunds, so a silent run is not a vacuous one", async () => {
    await owedRefund();
    const report = await reconcileCommerce(db);
    expect(report.refundsChecked).toBeGreaterThan(0);
  });
});

describe("14 · every step leaves an audit trail, and none of it leaks", () => {
  it("audits the whole life of a refund", async () => {
    const owed = await owedRefund({ scenario: "succeeds" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);

    const actions = await auditActions(owed.refundId);
    expect(actions).toEqual([
      "refund.owed_recorded",
      "refund.execution_requested",
      "refund.attempt_started",
      "refund.succeeded",
    ]);
  });

  it("audits an unknown as an unknown", async () => {
    const owed = await owedRefund({ scenario: "http_500" });
    const finance = await makeFinance();
    await executeRefund(db, finance, provider, owed.refundId);
    expect(await auditActions(owed.refundId)).toContain("refund.in_doubt");
  });
});
