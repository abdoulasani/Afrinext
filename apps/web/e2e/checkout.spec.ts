import { createHmac } from "node:crypto";
import { completeBuyerProfile, completeBuyerProfileForOrder } from "./buyer-profile";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { MOCK_WEBHOOK_SECRET, SERVER_LOG } from "../playwright.config";

/**
 * Checkout, in a real browser against a real build.
 *
 * The buyer journey is driven through the interface a person actually uses —
 * product page, buy, pay — and the confirmation arrives the way a provider
 * sends it: an HMAC-signed POST to the webhook endpoint, from outside the
 * browser session entirely. Nothing in this file tells the server that a
 * payment succeeded by clicking anything, because in the real system nothing
 * can.
 */

const DB = process.env["DATABASE_URL"] ?? "";

/**
 * The first line of psql's output.
 *
 * Not `.trim()` on the whole thing: psql prints the command tag for an INSERT
 * even under `-At`, so the fixture's `insert … returning id` answers with the
 * id AND a trailing "INSERT 0 1". Concatenating them produced a uuid that
 * PostgreSQL then refused, in a test that had nothing to do with uuids.
 */
function sqlOne(statement: string): string {
  const output = execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" });
  return (output.split("\n")[0] ?? "").trim();
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

/** Requests from inside the page, so the Secure session cookie is attached. */
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

/**
 * A published product, created as fixture data.
 *
 * The seller's own journey — role, consent, store, product, publish — is
 * proved end to end in `catalog.spec.ts`. Repeating it here would make this
 * file slower and would not test anything checkout is responsible for.
 */
function publishedProduct(priceMinor: number): { storeSlug: string; productSlug: string; productId: string } {
  const storeSlug = unique("shop");
  const productSlug = unique("item");
  const productId = sqlOne(`
    with seller as (
      insert into users (id, display_name, locale, status)
      values (gen_random_uuid(), 'Vendeur ${storeSlug}', 'fr', 'active') returning id
    ), store as (
      insert into stores (id, owner_user_id, slug, name, status)
      select gen_random_uuid(), seller.id, '${storeSlug}', 'Boutique', 'published' from seller
      returning id
    )
    insert into products (id, store_id, slug, kind, title, price_minor, currency, status, published_at)
    select gen_random_uuid(), store.id, '${productSlug}', 'digital', 'Produit ${productSlug}',
           ${priceMinor}, 'XOF', 'published', now()
      from store
    returning id
  `);
  return { storeSlug, productSlug, productId };
}

/** Signs an event the way the mock provider does: HMAC-SHA256 over raw bytes. */
function signedEvent(payload: Record<string, unknown>): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return {
    body,
    signature: createHmac("sha256", MOCK_WEBHOOK_SECRET).update(Buffer.from(body, "utf8")).digest("hex"),
  };
}

/**
 * Delivers a provider event.
 *
 * Through Playwright's own request context, NOT the page — a provider has no
 * session and no cookie, and the endpoint must not need one.
 */
async function deliver(
  request: APIRequestContext,
  payload: Record<string, unknown>,
  options: { signature?: string } = {},
): Promise<number> {
  const { body, signature } = signedEvent(payload);
  const response = await request.post("/api/v1/payments/webhook", {
    headers: {
      "content-type": "application/json",
      "x-mock-signature": options.signature ?? signature,
    },
    data: body,
  });
  return response.status();
}

function providerRefFor(orderId: string): string {
  return sqlOne(`select provider_ref from payments where order_id = '${orderId}'::uuid`);
}

function orderStatus(orderId: string): string {
  return sqlOne(`select status from orders where id = '${orderId}'::uuid`);
}

test.describe("a buyer pays for a digital product", () => {
  test("the whole journey, and the confirmation comes from the provider", async ({ page, request }) => {
    const product = publishedProduct(15000);
    const buyerPhone = freshPhone();
    const buyerId = await signIn(page, buyerPhone);

    /*
     * The link a charge depends on, after a REAL phone-OTP signup.
     *
     * `initiatePayment` sources the payer's number by joining `users` to Better
     * Auth's `user` through `auth_user_id`, and the core tests fabricate that
     * pair. This asserts the real signup actually produces it, and that the
     * number is the verified one — which is the half no unit test can prove.
     */
    expect(
      sqlOne(`select au."phoneNumber" from users u join "user" au on au.id = u.auth_user_id
                where u.id = '${buyerId}'::uuid and au."phoneNumberVerified"`),
      "the buyer's verified sign-in number is reachable from their identity",
    ).toBe(buyerPhone);

    // 1. The public product page now offers a real purchase.
    await page.goto(`/fr/s/${product.storeSlug}/${product.productSlug}`);
    await expect(page.getByTestId("product-price")).toHaveText(/^15\s000\sXOF$/);
    await page.getByTestId("buy").click();

    // 2. An order exists, priced by the server, and it is not paid.
    await page.waitForURL(/\/fr\/orders\/[0-9a-f-]{36}$/);
    const orderId = (/orders\/([0-9a-f-]{36})/.exec(page.url()) ?? [])[1] as string;
    await expect(page.getByTestId("order-total")).toHaveText(/^15\s000\sXOF$/);
    await expect(page.getByTestId("order-status")).toHaveText("En attente de paiement");
    expect(sqlOne(`select total_minor from orders where id = '${orderId}'::uuid`)).toBe("15000");

    // 3. Pay. The charge is created; nothing is confirmed.
    await completeBuyerProfile(page);
    await page.getByTestId("pay").click();
    /*
     * Wait for the payment STATE, not for the button's caption.
     *
     * `pay-waiting` is static text inside the form: it is on screen before the
     * server action has done anything, so asserting it proved only that the
     * page had rendered. The page now shows the charge's real status, which
     * appears when the action has actually completed — a signal rather than a
     * hope. CI caught this by racing where local runs happened not to.
     */
    await expect(page.getByTestId("payment-status")).toHaveText("pending");
    expect(sqlOne(`select status from payments where order_id = '${orderId}'::uuid`)).toBe("pending");
    expect(orderStatus(orderId)).toBe("pending_payment");

    // The buyer owns nothing yet, and the ledger has not moved.
    expect(sqlOne("select count(*) from entitlements")).toBe("0");
    expect(sqlOne("select count(*) from ledger_entries")).toBe("0");

    // 4. The provider confirms — signed, over raw bytes, with no session.
    const providerRef = providerRefFor(orderId);
    const status = await deliver(request, {
      id: unique("evt"), type: "charge.succeeded", providerRef,
      status: "succeeded", amountMinor: "15000", currency: "XOF",
    });
    expect(status).toBe(200);

    // 5. The order is paid, the entitlement exists, and the page says so.
    expect(orderStatus(orderId)).toBe("paid");
    await page.reload();
    await expect(page.getByTestId("order-status")).toHaveText("Payée");
    await expect(page.getByTestId("order-paid")).toBeVisible();

    // The screen states the boundary rather than implying the seller was paid.
    await expect(page.getByText("Le règlement au vendeur est une étape distincte")).toBeVisible();

    // 6. The library shows it, and the product page knows it is owned.
    await page.goto("/fr/orders");
    await expect(page.getByTestId("library")).toContainText(`Produit ${product.productSlug}`);
    await page.goto(`/fr/s/${product.storeSlug}/${product.productSlug}`);
    await expect(page.getByTestId("already-owned")).toBeVisible();
    await expect(page.getByTestId("buy")).toHaveCount(0);

    // 7. The commission was frozen, and the split re-sums to the gross.
    const lines = sqlOne(`
      select string_agg(l.key || '=' || l.amount_minor, ',' order by l.key)
        from fee_lines l join fee_schedules s on s.id = l.schedule_id
       where s.subject_type = 'order' and s.subject_id = '${orderId}'::uuid
    `);
    expect(lines).toBe("platform=2700,seller=12300");

    // 8. And still nothing in the ledger. Confirmation is not settlement.
    expect(sqlOne("select count(*) from ledger_entries")).toBe("0");
  });

  test("the browser cannot confirm its own payment", async ({ page, request }) => {
    const product = publishedProduct(4000);
    await signIn(page, freshPhone());

    const created = await api(page, "POST", "/api/v1/checkout", {
      storeSlug: product.storeSlug,
      productSlug: product.productSlug,
      idempotencyKey: unique("k"),
    });
    expect(created.status).toBe(201);
    const orderId = (created.body as { data: { id: string } }).data.id;
    await completeBuyerProfileForOrder(page, "fr", orderId);
    await api(page, "POST", `/api/v1/orders/${orderId}/pay`);
    const providerRef = providerRefFor(orderId);

    // The signed-in buyer posts a perfectly formed success event to the webhook
    // from inside their own session. It is refused, because a session is not a
    // signature and this endpoint has never cared about cookies.
    const forged = await api(page, "POST", "/api/v1/payments/webhook", {
      id: unique("evt"), type: "charge.succeeded", providerRef,
      status: "succeeded", amountMinor: "4000", currency: "XOF",
    });
    expect(forged.status).toBe(400);
    expect(orderStatus(orderId)).toBe("pending_payment");

    // A wrong signature is refused too.
    const badSignature = await deliver(
      request,
      { id: unique("evt"), type: "charge.succeeded", providerRef, status: "succeeded" },
      { signature: "0".repeat(64) },
    );
    expect(badSignature).toBe(400);
    expect(orderStatus(orderId)).toBe("pending_payment");

    // An event claiming a smaller amount is refused, and leaves evidence.
    const wrongAmount = await deliver(request, {
      id: "evt-wrong-amount-" + orderId, type: "charge.succeeded", providerRef,
      status: "succeeded", amountMinor: "1", currency: "XOF",
    });
    expect(wrongAmount).toBe(400);
    expect(orderStatus(orderId)).toBe("pending_payment");
    expect(
      sqlOne(`select outcome from payment_events where provider_event_id = 'evt-wrong-amount-${orderId}'`),
    ).toBe("rejected");

    // The genuine event still works afterwards.
    expect(
      await deliver(request, {
        id: unique("evt"), type: "charge.succeeded", providerRef,
        status: "succeeded", amountMinor: "4000", currency: "XOF",
      }),
    ).toBe(200);
    expect(orderStatus(orderId)).toBe("paid");
  });

  test("the client cannot choose the price, and a replay cannot buy twice", async ({ page, request }) => {
    const product = publishedProduct(9000);
    await signIn(page, freshPhone());
    const key = unique("k");

    // A price, a total and a currency are sent. They are not fields this API
    // has, so they cannot be honoured — the order costs what the catalogue says.
    const created = await api(page, "POST", "/api/v1/checkout", {
      storeSlug: product.storeSlug,
      productSlug: product.productSlug,
      idempotencyKey: key,
      priceMinor: "1", totalMinor: "1", currency: "EUR", commissionBps: 0,
    });
    expect(created.status).toBe(201);
    const order = (created.body as { data: { id: string; totalMinor: string; currency: string } }).data;
    expect(order.totalMinor).toBe("9000");
    expect(order.currency).toBe("XOF");

    // The same key again: the same order, and 200 rather than 201.
    const again = await api(page, "POST", "/api/v1/checkout", {
      storeSlug: product.storeSlug, productSlug: product.productSlug, idempotencyKey: key,
    });
    expect(again.status).toBe(200);
    expect((again.body as { data: { id: string } }).data.id).toBe(order.id);

    await completeBuyerProfileForOrder(page, "fr", order.id);
    await api(page, "POST", `/api/v1/orders/${order.id}/pay`);
    const providerRef = providerRefFor(order.id);
    const eventId = unique("evt");
    const payload = {
      id: eventId, type: "charge.succeeded", providerRef,
      status: "succeeded", amountMinor: "9000", currency: "XOF",
    };

    // Delivered three times, as a provider retrying an unacknowledged webhook
    // genuinely does.
    expect(await deliver(request, payload)).toBe(200);
    expect(await deliver(request, payload)).toBe(200);
    expect(await deliver(request, payload)).toBe(200);

    expect(orderStatus(order.id)).toBe("paid");
    expect(
      sqlOne(`select count(*) from entitlements where product_id = '${product.productId}'::uuid`),
    ).toBe("1");
    expect(
      sqlOne(`select count(*) from fee_schedules where subject_id = '${order.id}'::uuid`),
    ).toBe("1");
    expect(sqlOne(`select count(*) from payment_events where provider_event_id = '${eventId}'`)).toBe("1");
  });

  test("refuses an anonymous checkout and someone else's order", async ({ page, request, browser }) => {
    const product = publishedProduct(2500);

    // Anonymous: no session, no order.
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    await visitor.goto(`/fr/s/${product.storeSlug}/${product.productSlug}`);
    await expect(visitor.getByTestId("sign-in-to-buy")).toBeVisible();
    const refused = await api(visitor, "POST", "/api/v1/checkout", {
      storeSlug: product.storeSlug, productSlug: product.productSlug, idempotencyKey: unique("k"),
    });
    expect(refused.status).toBe(401);
    await anonymous.close();

    // One buyer creates an order.
    await signIn(page, freshPhone());
    const created = await api(page, "POST", "/api/v1/checkout", {
      storeSlug: product.storeSlug, productSlug: product.productSlug, idempotencyKey: unique("k"),
    });
    const orderId = (created.body as { data: { id: string } }).data.id;

    // A different signed-in person cannot pay it, cannot read it, and cannot
    // reach its page.
    const other = await browser.newContext();
    const stranger = await other.newPage();
    await signIn(stranger, freshPhone());
    const stolen = await api(stranger, "POST", `/api/v1/orders/${orderId}/pay`);
    expect(stolen.status).toBe(404);
    const page404 = await stranger.goto(`/fr/orders/${orderId}`);
    expect(page404?.status()).toBe(404);
    await other.close();

    expect(sqlOne(`select count(*) from payments where order_id = '${orderId}'::uuid`)).toBe("0");

    // And an event for a charge that does not exist changes nothing.
    expect(
      await deliver(request, {
        id: unique("evt"), type: "charge.succeeded", providerRef: "mockchg_00000000",
        status: "succeeded", amountMinor: "2500", currency: "XOF",
      }),
    ).toBe(400);
    expect(orderStatus(orderId)).toBe("pending_payment");
  });
});
