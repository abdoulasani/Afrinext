import { createHmac } from "node:crypto";
import { completeBuyerProfile } from "./buyer-profile";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { MOCK_WEBHOOK_SECRET, SERVER_LOG } from "../playwright.config";

/**
 * Digital delivery, through the application a person actually uses.
 *
 * The seller signs in, opens a store, creates a product, uploads a PDF and
 * publishes it. The buyer signs in, pays through the mock provider, and reads
 * the file. Then a second buyer — signed in, with their own account and no
 * purchase — tries every way there is to reach the same bytes.
 *
 * Success is never declared from the database. What proves the buyer received
 * the file is that an HTTP request returned the file.
 */

const DB = process.env["DATABASE_URL"] ?? "";
const PDF = "%PDF-1.7\nle guide de Niamey\n%%EOF\n";

/** Only ever used to arrange the world, never to assert a result. */
function fixtureSql(statement: string): string {
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
      const text = await response.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* not json */ }
      return { status: response.status, body: parsed };
    },
    [method, path, body] as [string, string, unknown],
  );
}

/** Fetches a URL from inside the page and reports status plus body text. */
async function fetchText(page: Page, path: string): Promise<{ status: number; text: string; disposition: string | null }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, { credentials: "same-origin" });
    return {
      status: response.status,
      text: await response.text(),
      disposition: response.headers.get("content-disposition"),
    };
  }, path);
}

async function signIn(page: Page, phone: string): Promise<void> {
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
}

/** The seller journey, through the seller's own screens. */
async function publishProductWithFile(page: Page, browser: Browser): Promise<{
  storeSlug: string;
  productSlug: string;
}> {
  const phone = freshPhone();
  const storeSlug = unique("librairie");
  await signIn(page, phone);

  // The `seller` role is an admin grant, which is the one part of the seller
  // journey with no screen yet. Everything after it is the real interface.
  const userId = fixtureSql(
    `select u.id from users u join "user" au on au.id = u.auth_user_id
      where au."phoneNumber" = '${phone}'`,
  );
  fixtureSql(
    `insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
     select gen_random_uuid(), '${userId}'::uuid, r.id, 'global', null
       from roles r where r.key = 'seller'`,
  );

  await page.goto("/fr/sell");
  await page.getByTestId("consent-accept").click();
  await page.locator('input[name="name"]').fill(storeSlug);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(new RegExp(`/fr/sell/${storeSlug}$`));

  await page.getByRole("button", { name: "Publier la boutique" }).click();
  await expect(page.getByRole("link", { name: "Voir la page publique" }).first()).toBeVisible();

  await page.locator('input[name="title"]').fill("Guide de Niamey");
  await page.locator('input[name="price"]').fill("15 000");
  await page.getByRole("button", { name: "Ajouter un produit numérique" }).click();
  await expect(page.getByText("Guide de Niamey")).toBeVisible();

  // Before the file, the seller is told the product would deliver nothing.
  const productId = fixtureSql(
    `select p.id from products p join stores s on s.id = p.store_id
      where s.slug = '${storeSlug}' and p.slug = 'guide-de-niamey'`,
  );
  await expect(page.getByTestId(`no-assets-${productId}`)).toBeVisible();

  // Upload it, through the seller's form.
  await page.getByTestId(`asset-title-${productId}`).fill("Le guide (PDF)");
  await page.getByTestId(`asset-file-${productId}`).setInputFiles({
    name: "guide.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF, "utf8"),
  });
  await page.getByTestId(`asset-submit-${productId}`).click();
  await expect(page.getByText("Le guide (PDF)")).toBeVisible();
  await expect(page.getByTestId(`no-assets-${productId}`)).toHaveCount(0);

  await page.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(page.getByRole("link", { name: "Voir la page publique" })).toHaveCount(2);

  void browser;
  return { storeSlug, productSlug: "guide-de-niamey" };
}

/** Buys the product through the real screens and the real webhook. */
async function buy(
  page: Page,
  request: APIRequestContext,
  storeSlug: string,
  productSlug: string,
): Promise<void> {
  await page.goto(`/fr/s/${storeSlug}/${productSlug}`);
  await page.getByTestId("buy").click();
  await page.waitForURL(/\/fr\/orders\/[0-9a-f-]{36}$/);
  await completeBuyerProfile(page);
  await page.getByTestId("pay").click();
  /*
   * Wait for the payment STATE, not for the button's caption.
   *
   * `pay-waiting` is static text inside the form — it is on screen before the
   * server action has done anything, so asserting it proved only that the page
   * had rendered, and the `provider_ref` read below then raced the charge
   * being created. When it lost, the webhook was posted with an empty
   * reference and answered 400. `payment-status` appears only once the action
   * has actually completed, which is a signal rather than a hope.
   *
   * `checkout.spec.ts` was corrected the same way for the same reason; this
   * copy of the journey kept the old wait, and CI run #36 caught it.
   */
  await expect(page.getByTestId("payment-status")).toHaveText("pending");

  const orderId = (/orders\/([0-9a-f-]{36})/.exec(page.url()) ?? [])[1] as string;
  const providerRef = fixtureSql(
    `select provider_ref from payments where order_id = '${orderId}'::uuid`,
  );
  // If this is ever empty again, fail here naming the cause rather than three
  // lines later as an unexplained 400 from the webhook.
  expect(providerRef, "the charge must exist before it can be confirmed").not.toBe("");

  const payload = JSON.stringify({
    id: unique("evt"), type: "charge.succeeded", providerRef,
    status: "succeeded", amountMinor: "15000", currency: "XOF",
  });
  const response = await request.post("/api/v1/payments/webhook", {
    headers: {
      "content-type": "application/json",
      "x-mock-signature": createHmac("sha256", MOCK_WEBHOOK_SECRET)
        .update(Buffer.from(payload, "utf8")).digest("hex"),
    },
    data: payload,
  });
  expect(response.status()).toBe(200);
}

test.describe("a paid buyer receives the file, and nobody else does", () => {
  test("the whole journey, then an unauthorized buyer tries everything", async ({
    page, request, browser,
  }) => {
    const { storeSlug, productSlug } = await publishProductWithFile(page, browser);

    // ---- the buyer -------------------------------------------------------
    const buyerContext = await browser.newContext();
    const buyer = await buyerContext.newPage();
    await signIn(buyer, freshPhone());

    // Before paying, the library page for this product does not exist for them.
    const before = await buyer.goto(`/fr/library/${storeSlug}/${productSlug}`);
    expect(before?.status(), "not bought yet").toBe(404);

    await buy(buyer, request, storeSlug, productSlug);

    // The product page now says they own it and offers the library.
    await buyer.goto(`/fr/s/${storeSlug}/${productSlug}`);
    await expect(buyer.getByTestId("already-owned")).toBeVisible();
    await buyer.getByTestId("open-library").click();
    await buyer.waitForURL(new RegExp(`/fr/library/${storeSlug}/${productSlug}$`));

    // The file is listed, and the button hands over the bytes.
    await expect(buyer.getByTestId("assets")).toContainText("Le guide (PDF)");

    const grant = await api(buyer, "POST", `/api/v1/library/${storeSlug}/${productSlug}/access`, {
      assetId: await buyer
        .getByTestId("assets")
        .locator("button")
        .first()
        .getAttribute("data-testid")
        .then((id) => (id ?? "").replace("asset-open-", "")),
      disposition: "attachment",
    });
    expect(grant.status).toBe(200);
    const url = (grant.body as { data: { url: string } }).data.url;

    // THE ASSERTION THIS MILESTONE IS ABOUT: the bytes come back over HTTP.
    const delivered = await fetchText(buyer, url);
    expect(delivered.status).toBe(200);
    expect(delivered.text).toBe(PDF);
    expect(delivered.disposition).toContain("attachment");

    // ---- an unauthorized buyer ------------------------------------------
    const otherContext = await browser.newContext();
    const stranger = await otherContext.newPage();
    await signIn(stranger, freshPhone());

    // 1. The library page for a product they have not bought.
    const strangerPage = await stranger.goto(`/fr/library/${storeSlug}/${productSlug}`);
    expect(strangerPage?.status(), "a stranger's library page").toBe(404);

    // 2. Asking for a grant with the same asset id, in their own session.
    const assetId = url.split("/").pop() as string;
    const refusedGrant = await api(
      stranger,
      "POST",
      `/api/v1/library/${storeSlug}/${productSlug}/access`,
      { assetId, disposition: "attachment" },
    );
    expect(refusedGrant.status, "a grant for content they do not own").toBe(403);

    // 3. Replaying the buyer's own grant URL inside their session. The grant is
    //    valid and unexpired; it is bound to somebody else.
    const stolen = await fetchText(stranger, url);
    expect(stolen.status, "another person's grant").toBe(403);
    expect(stolen.text).not.toContain("%PDF");

    // 4. The same URL with no session at all.
    const anonymousContext = await browser.newContext();
    const visitor = await anonymousContext.newPage();
    await visitor.goto(`/fr/s/${storeSlug}/${productSlug}`);
    const anonymous = await fetchText(visitor, url);
    expect(anonymous.status, "no session").toBe(401);
    expect(anonymous.text).not.toContain("%PDF");

    // 5. And the seller screens are still not theirs.
    const sellerScreens = await stranger.goto(`/fr/sell/${storeSlug}`);
    expect(sellerScreens?.status()).toBe(404);

    await anonymousContext.close();
    await otherContext.close();
    await buyerContext.close();
  });

  test("removing the button from the DOM does not deliver the file", async ({
    page, request, browser,
  }) => {
    const { storeSlug, productSlug } = await publishProductWithFile(page, browser);

    const buyerContext = await browser.newContext();
    const buyer = await buyerContext.newPage();
    await signIn(buyer, freshPhone());
    await buy(buyer, request, storeSlug, productSlug);
    await buyer.goto(`/fr/library/${storeSlug}/${productSlug}`);

    const assetId = ((await buyer
      .getByTestId("assets")
      .locator("button")
      .first()
      .getAttribute("data-testid")) ?? "").replace("asset-open-", "");

    // The buyer's own page, with the interface removed. The server does not
    // care: this person is entitled, so it still works.
    await buyer.evaluate(() => document.querySelectorAll("button").forEach((b) => b.remove()));
    const mine = await api(buyer, "POST", `/api/v1/library/${storeSlug}/${productSlug}/access`, {
      assetId, disposition: "attachment",
    });
    expect(mine.status).toBe(200);

    // And the reverse: a stranger who reconstructs the exact same request by
    // hand is refused. The interface was never what decided.
    const otherContext = await browser.newContext();
    const stranger = await otherContext.newPage();
    await signIn(stranger, freshPhone());
    await stranger.goto(`/fr/s/${storeSlug}/${productSlug}`);
    const forged = await api(
      stranger, "POST", `/api/v1/library/${storeSlug}/${productSlug}/access`,
      { assetId, disposition: "attachment" },
    );
    expect(forged.status).toBe(403);

    // A made-up token is refused too, and says nothing about why.
    const invented = await fetchText(stranger, "/api/v1/content/not-a-real-grant");
    expect(invented.status).toBe(403);

    await otherContext.close();
    await buyerContext.close();
  });
});
