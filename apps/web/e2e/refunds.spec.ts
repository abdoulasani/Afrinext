import { createHmac } from "node:crypto";
import { completeBuyerProfile, chooseMobileMoney } from "./buyer-profile";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { MOCK_WEBHOOK_SECRET, SERVER_LOG } from "../playwright.config";

/**
 * Refund execution, in a real browser against a real build.
 *
 * The browser layer is where a reviewer looks for the thing that should not be
 * there. Two claims this file exists to make in a way nobody has to take on
 * trust:
 *
 *   1. There is no "mark as refunded" control. Not hidden, not disabled —
 *      absent from the DOM, and absent from the API surface too.
 *   2. A refund of unknown outcome offers no way to send a second request. The
 *      screen offers "ask the provider" instead, which is a question rather
 *      than an instruction.
 *
 * The refund is created the way production creates one: a real order, a real
 * charge, a real signed webhook arriving after the grace window, and the late
 * payment policy deciding `refund_due`. Nothing in this file inserts a refund.
 */

const DB = process.env["DATABASE_URL"] ?? "";

function sqlOne(statement: string): string {
  const output = execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" });
  return (output.split("\n")[0] ?? "").trim();
}

function sqlRun(statement: string): void {
  execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" });
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
}

function freshPhone(): string {
  return `+22790${String(Math.floor(100000 + Math.random() * 899999))}`;
}

function logLength(): number {
  try { return readFileSync(SERVER_LOG, "utf8").length; } catch { return 0; }
}

async function codeSentTo(phone: string, since: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  const wanted = new RegExp(`would send to \\${phone}: Afrinext: (\\d{6})`);
  while (Date.now() < deadline) {
    let log = "";
    try { log = readFileSync(SERVER_LOG, "utf8").slice(since); } catch { /* not yet */ }
    const match = wanted.exec(log);
    if (match?.[1] !== undefined) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification code was sent to ${phone} within 15s.`);
}

async function api(
  page: Page, method: "GET" | "POST", path: string, body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ([verb, target, payload]) => {
      const response = await fetch(target as string, {
        method: verb as string,
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return { status: response.status, body: await response.json() };
    },
    [method, path, body] as [string, string, unknown],
  );
}

async function signIn(page: Page, phone: string): Promise<string> {
  await page.goto("/fr/sign-in");
  const before = logLength();
  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();
  await page.locator('input[inputmode="numeric"]').fill(await codeSentTo(phone, before));
  await page.locator('button[type="submit"]').click();
  await Promise.race([
    page.getByTestId("signup-consent").waitFor({ state: "visible" }),
    page.waitForURL(/\/wallet$/),
  ]);
  if (await page.getByTestId("signup-consent").isVisible()) {
    await page.locator('input[name="agree"]').check();
    await page.getByTestId("signup-consent-accept").click();
  }
  await page.waitForURL(/\/wallet$/);
  return sqlOne(
    `select u.id from users u join "user" au on au.id = u.auth_user_id
      where au."phoneNumber" = '${phone}'`,
  );
}

function grant(userId: string, roleKey: string): void {
  sqlRun(`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), '${userId}'::uuid, r.id, 'global', null
      from roles r where r.key = '${roleKey}'
  `);
}

/**
 * Step-up elevation, applied the way the auth flow applies it.
 *
 * `session.elevatedAt` is what `resolveActor` reads, and the browser suite has
 * no re-verification screen to drive yet. Setting the column is the same state
 * that flow would produce — and the test that matters here is the one BELOW,
 * which removes the elevation and shows the refusal.
 */
function elevate(userId: string): void {
  sqlRun(`
    update session set "elevatedAt" = now()
     where "userId" = (select auth_user_id from users where id = '${userId}'::uuid)
  `);
}

function deElevate(userId: string): void {
  sqlRun(`
    update session set "elevatedAt" = null
     where "userId" = (select auth_user_id from users where id = '${userId}'::uuid)
  `);
}

function publishedProduct(priceMinor: number): { storeSlug: string; productSlug: string } {
  const storeSlug = unique("rshop");
  const productSlug = unique("ritem");
  sqlRun(`
    with seller as (
      insert into users (id, display_name, locale, status)
      values (gen_random_uuid(), 'Vendeur ${storeSlug}', 'fr', 'active') returning id
    ), store as (
      insert into stores (id, owner_user_id, slug, name, status, published_at)
      select gen_random_uuid(), seller.id, '${storeSlug}', 'Boutique', 'published', now()
        from seller
      returning id
    )
    insert into products (id, store_id, slug, kind, title, price_minor, currency, status, published_at)
    select gen_random_uuid(), store.id, '${productSlug}', 'digital', 'Produit ${productSlug}',
           ${priceMinor}, 'XOF', 'published', now()
      from store
  `);
  return { storeSlug, productSlug };
}

/**
 * Drives a real purchase to `refund_due`, and returns the refund's id.
 *
 * The webhook is delivered from Playwright's request context rather than the
 * page: a provider has no session and no cookie, and the endpoint must not
 * need one.
 */
async function refundDueFor(page: Page, priceMinor: number): Promise<string> {
  const product = publishedProduct(priceMinor);
  await page.goto(`/fr/s/${product.storeSlug}/${product.productSlug}`);
  await page.getByTestId("buy").click();
  await page.waitForURL(/\/fr\/orders\/[0-9a-f-]{36}$/);
  const orderId = (/orders\/([0-9a-f-]{36})/.exec(page.url()) ?? [])[1] as string;

  await completeBuyerProfile(page);
  await chooseMobileMoney(page);
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("payment-status")).toHaveText("pending");
  const providerRef = sqlOne(`select provider_ref from payments where order_id = '${orderId}'::uuid`);

  // Push the checkout past expiry AND past the 24-hour grace window, so the
  // late payment is owed a refund rather than fulfilled.
  sqlRun(`
    update orders set expires_at = now() - interval '48 hours' where id = '${orderId}'::uuid
  `);
  sqlRun(`
    update orders set status = 'expired', closed_at = now()
     where id = '${orderId}'::uuid and status = 'pending_payment'
  `);

  const payload = JSON.stringify({
    id: unique("evt"),
    subject: "charge",
    type: "charge.succeeded",
    providerRef,
    status: "succeeded",
    amountMinor: String(priceMinor),
    currency: "XOF",
  });
  const signature = createHmac("sha256", MOCK_WEBHOOK_SECRET)
    .update(Buffer.from(payload, "utf8")).digest("hex");
  const response = await page.request.post("/api/v1/payments/webhook", {
    headers: { "content-type": "application/json", "x-mock-signature": signature },
    data: payload,
  });
  expect(response.status()).toBe(200);

  expect(sqlOne(`select status from orders where id = '${orderId}'::uuid`)).toBe("refund_due");
  const refundId = sqlOne(`select id from refunds where order_id = '${orderId}'::uuid`);
  expect(refundId).toMatch(/^[0-9a-f-]{36}$/);
  return refundId;
}

test.describe("the refund queue an operator works from", () => {
  test("a refund_due order appears as an owed refund, and finance can send it", async ({ page }) => {
    const financeId = await signIn(page, freshPhone());
    const refundId = await refundDueFor(page, 15000);

    grant(financeId, "finance");
    elevate(financeId);

    await page.goto("/fr/admin/refunds");
    const row = page.getByTestId(`refund-${refundId}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("refund-amount")).toHaveText(/^15\s000\sXOF$/);
    await expect(row.getByTestId("refund-status")).toHaveAttribute("data-status", "owed");
    await expect(row.getByTestId("refund-attempts")).toHaveText("0");

    /*
     * The claim, made in the DOM.
     *
     * No control anywhere on this page marks a refund as done. The only way
     * money is recorded as returned is a provider saying so, or two people
     * reconciling against a statement.
     */
    await expect(page.getByText(/mark as refunded/i)).toHaveCount(0);

    await row.getByTestId("refund-execute").click();
    await expect(row.getByTestId("refund-status")).toHaveAttribute("data-status", "succeeded");

    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("succeeded");
    // Evidence, not a claim: a reference and a source, both required by a CHECK.
    expect(sqlOne(`select resolved_by from refunds where id = '${refundId}'::uuid`)).toBe("response");
    expect(
      sqlOne(`select provider_refund_ref is not null from refunds where id = '${refundId}'::uuid`),
    ).toBe("t");
    // Exactly one attempt, and one refund at the provider.
    expect(sqlOne(`select count(*) from refund_attempts where refund_id = '${refundId}'::uuid`))
      .toBe("1");
    // Still no ledger movement: settlement is a later phase.
    expect(sqlOne("select count(*) from ledger_entries")).toBe("0");
  });

  test("an ordinary buyer cannot see the queue or execute anything", async ({ page }) => {
    const buyerId = await signIn(page, freshPhone());
    const refundId = await refundDueFor(page, 9000);

    await page.goto("/fr/admin/refunds");
    // The page renders a refusal rather than a queue.
    await expect(page.getByTestId("refund-queue")).toHaveCount(0);

    // And the API refuses the same person, so the page was not the control.
    const queue = await api(page, "GET", "/api/v1/admin/refunds");
    expect(queue.status).toBe(403);

    const execute = await api(page, "POST", `/api/v1/admin/refunds/${refundId}/execute`);
    expect(execute.status).toBe(403);
    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("owed");

    // The scheduler door is shut too — no token, no permission.
    const scheduler = await api(page, "POST", "/api/v1/admin/refunds/process");
    expect(scheduler.status).toBe(403);

    void buyerId;
  });

  test("support may read the queue and may not execute", async ({ page }) => {
    const supportId = await signIn(page, freshPhone());
    const refundId = await refundDueFor(page, 7000);

    grant(supportId, "support");
    elevate(supportId);

    await page.goto("/fr/admin/refunds");
    await expect(page.getByTestId(`refund-${refundId}`)).toBeVisible();
    // Reading is not touching: no send button is rendered for this operator...
    await expect(page.getByTestId(`refund-${refundId}`).getByTestId("refund-execute"))
      .toHaveCount(0);
    // ...and calling the route directly is refused all the same.
    const execute = await api(page, "POST", `/api/v1/admin/refunds/${refundId}/execute`);
    expect(execute.status).toBe(403);
    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("owed");
  });

  test("finance without a fresh verification is refused", async ({ page }) => {
    const financeId = await signIn(page, freshPhone());
    const refundId = await refundDueFor(page, 6000);

    grant(financeId, "finance");
    deElevate(financeId);

    const execute = await api(page, "POST", `/api/v1/admin/refunds/${refundId}/execute`);
    expect(execute.status).toBe(403);
    expect((execute.body as { error?: { code?: string } }).error?.code)
      .toBe("auth.elevation_required");
    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("owed");
  });

  test("an unknown outcome offers a question, never a second request", async ({ page }) => {
    const financeId = await signIn(page, freshPhone());
    const refundId = await refundDueFor(page, 12000);

    grant(financeId, "finance");
    elevate(financeId);

    /*
     * The provider timed out with the refund already made.
     *
     * Reached by planting the state a timeout leaves behind rather than by
     * making the running server's provider misbehave: the mock lives in the
     * server process and this test lives outside it. What is being tested here
     * is the OPERATOR SURFACE over that state, and the state itself is proved
     * to arise from a real timeout by the unit suite.
     */
    sqlRun(`
      update refunds set status = 'in_doubt', attempt_count = 1,
                         requested_by_user_id = '${financeId}'::uuid
       where id = '${refundId}'::uuid
    `);
    sqlRun(`
      insert into refund_attempts (id, refund_id, attempt_no, idempotency_key,
                                   finished_at, outcome, stage, detail)
      values (gen_random_uuid(), '${refundId}', 1, 'refund:${refundId}:1', now(),
              'in_doubt', 'unknown', 'socket timed out awaiting response')
    `);

    await page.goto("/fr/admin/refunds");
    const row = page.getByTestId(`refund-${refundId}`);
    await expect(row.getByTestId("refund-status")).toHaveAttribute("data-status", "in_doubt");

    // The screen SAYS what unknown means, so nobody reads it as failure.
    await expect(row.getByTestId("in-doubt-explainer")).toBeVisible();

    // There is no send button on an unknown refund...
    await expect(row.getByTestId("refund-execute")).toHaveCount(0);
    // ...and the route refuses too, with the reason spelled out.
    const retry = await api(page, "POST", `/api/v1/admin/refunds/${refundId}/execute`);
    expect(retry.status).toBe(400);
    expect((retry.body as { error?: { message?: string } }).error?.message)
      .toMatch(/never retried|Resolve it first/i);

    // What IS offered is a question to the provider.
    await expect(row.getByTestId("refund-resolve")).toBeVisible();
  });

  test("manual reconciliation needs a second person, an evidence trail and a reference", async ({ page, browser }) => {
    const firstId = await signIn(page, freshPhone());
    const refundId = await refundDueFor(page, 11000);

    grant(firstId, "finance");
    elevate(firstId);
    sqlRun(`
      update refunds set status = 'in_doubt', attempt_count = 1,
                         requested_by_user_id = '${firstId}'::uuid
       where id = '${refundId}'::uuid
    `);

    // A second finance user, in a separate browser context with their own
    // session — dual control is not two clicks by one person.
    const second = await browser.newContext();
    const secondPage = await second.newPage();
    const secondId = await signIn(secondPage, freshPhone());
    grant(secondId, "finance");
    elevate(secondId);

    // Claiming a success without naming a provider reference is refused.
    const noRef = await api(page, "POST", `/api/v1/admin/refunds/${refundId}/reconcile`, {
      action: "propose", outcome: "succeeded", evidence: "I am sure",
    });
    expect(noRef.status).toBe(400);

    const proposed = await api(page, "POST", `/api/v1/admin/refunds/${refundId}/reconcile`, {
      action: "propose",
      outcome: "succeeded",
      providerRefundRef: "STMT-BROWSER-4242",
      evidence: "provider statement, line 12",
    });
    expect(proposed.status).toBe(200);
    // Proposing moves nothing.
    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("in_doubt");

    // The proposer may not confirm their own proposal.
    const selfConfirm = await api(page, "POST", `/api/v1/admin/refunds/${refundId}/reconcile`, {
      action: "confirm",
    });
    expect(selfConfirm.status).toBe(400);
    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("in_doubt");

    // The second person can.
    const confirmed = await api(secondPage, "POST", `/api/v1/admin/refunds/${refundId}/reconcile`, {
      action: "confirm",
    });
    expect(confirmed.status).toBe(200);
    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("succeeded");
    expect(sqlOne(`select reconciliation_mode from refunds where id = '${refundId}'::uuid`))
      .toBe("two_person");
    expect(sqlOne(`select provider_refund_ref from refunds where id = '${refundId}'::uuid`))
      .toBe("STMT-BROWSER-4242");
    // Both people are on the record.
    expect(
      sqlOne(`select reconciled_by_user_id <> reconciled_confirmed_by_user_id
                from refunds where id = '${refundId}'::uuid`),
    ).toBe("t");

    await second.close();
  });

  test("the buyer is queued a notice and nothing pretends to have sent it", async ({ page }) => {
    const financeId = await signIn(page, freshPhone());
    const refundId = await refundDueFor(page, 8000);
    grant(financeId, "finance");
    elevate(financeId);

    await api(page, "POST", `/api/v1/admin/refunds/${refundId}/execute`);
    expect(sqlOne(`select status from refunds where id = '${refundId}'::uuid`)).toBe("succeeded");

    // One row per event per subject, and every row still pending: no SMS
    // provider is configured, and nothing claims otherwise.
    expect(
      sqlOne(`select count(*) from notification_outbox
               where subject_id = '${refundId}'::uuid and kind = 'refund.succeeded'`),
    ).toBe("1");
    expect(
      sqlOne(`select count(*) from notification_outbox where status <> 'pending'`),
    ).toBe("0");
  });
});
