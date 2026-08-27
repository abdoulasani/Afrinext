import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { MOCK_WEBHOOK_SECRET, SERVER_LOG } from "../playwright.config";
import { completeBuyerProfile, chooseMobileMoney } from "./buyer-profile";
import { createStoreViaWizard } from "./store-wizard";

/**
 * The digital product engine, through the real interface.
 *
 * The seller configures a licence and a download limit, uploads a file and
 * publishes. The buyer discovers the product, reads the licence BEFORE paying,
 * buys through the mock provider, opens their library and downloads — until the
 * limit stops them. Then everybody who should not have the file tries to get it.
 *
 * Nothing is asserted from the database that the interface could have shown,
 * and nothing is asserted from the interface that only the database can prove.
 */

const DB = process.env["DATABASE_URL"] ?? "";
const PDF_V1 = "%PDF-1.7\nversion one of the guide\n%%EOF\n";
const PDF_V2 = "%PDF-1.7\nversion two, corrected\n%%EOF\n";

function sql(statement: string): string {
  return (execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" })
    .split("\n")[0] ?? "").trim();
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
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No verification code was sent to ${phone} within 15s.`);
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
  return sql(`select u.id from users u join "user" au on au.id = u.auth_user_id
               where au."phoneNumber" = '${phone}'`);
}

function grantSeller(userId: string): void {
  execFileSync("psql", [DB, "-Atc",
    `insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
     select gen_random_uuid(), '${userId}'::uuid, r.id, 'global', null
       from roles r where r.key = 'seller'`], { encoding: "utf8" });
}

interface Listing {
  storeSlug: string;
  productSlug: string;
  productId: string;
}

/**
 * The seller's whole journey, through the seller's own screens: store, product,
 * file, licence, download limit, publish.
 */
async function sellerPublishes(
  page: Page,
  options: { licence: string; downloadLimit: number },
): Promise<Listing> {
  const storeSlug = unique("librairie");
  const userId = await signIn(page, freshPhone());
  grantSeller(userId);

  await page.goto("/fr/sell");
  await page.getByTestId("consent-accept").click();
  await createStoreViaWizard(page, { slug: storeSlug });
  await page.getByRole("button", { name: "Publier la boutique" }).click();
  await expect(page.getByRole("link", { name: "Voir la page publique" }).first()).toBeVisible();

  // The offering, priced in whole francs.
  await page.locator('input[name="title"]').fill("Guide de Niamey");
  await page.locator('input[name="summary"]').fill("Un guide pratique");
  await page.locator('input[name="price"]').fill("15 000");
  await page.getByRole("button", { name: "Ajouter un produit", exact: true }).click();
  await expect(page.getByText("Guide de Niamey")).toBeVisible();

  const productId = sql(
    `select p.id from products p join stores s on s.id = p.store_id
      where s.slug = '${storeSlug}' and p.slug = 'guide-de-niamey'`);

  // The file.
  await page.getByTestId(`asset-title-${productId}`).fill("Le guide (PDF)");
  await page.getByTestId(`asset-file-${productId}`).setInputFiles({
    name: "guide.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF_V1, "utf8"),
  });
  await page.getByTestId(`asset-submit-${productId}`).click();
  await expect(page.getByText("Le guide (PDF)")).toBeVisible();

  // The terms, and the limit.
  await page.getByTestId(`licence-${productId}`).fill(options.licence);
  await page.getByTestId(`save-licence-${productId}`).click();
  await expect(page.getByTestId(`licence-${productId}`)).toHaveValue(options.licence);

  await page.getByTestId(`limit-${productId}`).fill(String(options.downloadLimit));
  await page.getByTestId(`save-limit-${productId}`).click();
  await expect(page.getByTestId(`limit-${productId}`))
    .toHaveValue(String(options.downloadLimit));

  await page.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(page.getByRole("link", { name: "Voir la page publique" })).toHaveCount(2);

  return { storeSlug, productSlug: "guide-de-niamey", productId };
}

/** Buys it through the real screens and the real signed webhook. */
async function buy(page: Page, request: APIRequestContext, l: Listing): Promise<string> {
  await page.goto(`/fr/s/${l.storeSlug}/${l.productSlug}`);
  await page.getByTestId("buy").click();
  await page.waitForURL(/\/fr\/orders\/[0-9a-f-]{36}$/);
  await completeBuyerProfile(page);
  await chooseMobileMoney(page);
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("payment-status")).toHaveText("pending");

  const orderId = (/orders\/([0-9a-f-]{36})/.exec(page.url()) ?? [])[1] as string;
  const providerRef = sql(`select provider_ref from payments where order_id = '${orderId}'::uuid`);
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
  return orderId;
}

/** Follows a download to its bytes, from inside the page's session. */
async function fetchAsset(page: Page, l: Listing, assetId: string): Promise<{
  status: number; text: string;
}> {
  return page.evaluate(async ([store, product, asset]) => {
    const minted = await fetch(`/api/v1/library/${store}/${product}/access`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: asset, disposition: "attachment" }),
    });
    if (!minted.ok) return { status: minted.status, text: await minted.text() };
    const body = (await minted.json()) as { data: { url: string } };
    const served = await fetch(body.data.url, { credentials: "same-origin" });
    return { status: served.status, text: await served.text() };
  }, [l.storeSlug, l.productSlug, assetId] as [string, string, string]);
}

// ===========================================================================

test.describe("the digital product engine, end to end", () => {
  test("seller configures and publishes; buyer reads the licence, buys, downloads to the limit",
    async ({ page, request, browser }) => {
      const licence = "Usage personnel uniquement. Pas de revente.";
      const listing = await sellerPublishes(page, { licence, downloadLimit: 2 });

      const assetId = sql(
        `select a.id from digital_assets a where a.product_id = '${listing.productId}'::uuid`);

      // ---- the licence is readable BEFORE paying, and by anyone -----------
      const anon = await browser.newContext();
      const visitor = await anon.newPage();
      await visitor.goto(`/fr/s/${listing.storeSlug}/${listing.productSlug}`);
      await expect(visitor.getByTestId("product-licence")).toContainText(licence);

      // An anonymous request for the bytes is refused.
      const anonymous = await fetchAsset(visitor, listing, assetId);
      expect(anonymous.status, "no session, no file").toBeGreaterThanOrEqual(400);
      await anon.close();

      // ---- the buyer ------------------------------------------------------
      const buyerContext = await browser.newContext();
      const buyer = await buyerContext.newPage();
      await signIn(buyer, freshPhone());

      // Their library is empty and says so.
      await buyer.goto("/fr/library");
      await expect(buyer.getByTestId("library-item")).toHaveCount(0);
      await expect(buyer.getByText("Votre bibliothèque est vide")).toBeVisible();

      await buy(buyer, request, listing);

      // No newer version exists yet, so nothing claims one does. A notice that
      // is always present is a notice nobody reads.
      await expect(buyer.getByTestId("newer-version")).toHaveCount(0);

      // The library now has exactly one item, naming the version bought.
      await buyer.goto("/fr/library");
      await expect(buyer.getByTestId("library-item")).toHaveCount(1);
      await expect(buyer.getByTestId("library-item")).toContainText("Guide de Niamey");
      await expect(buyer.getByTestId("library-item")).toContainText("Version 1");

      await buyer.getByTestId("library-item").click();
      await buyer.waitForURL(new RegExp(`/fr/library/${listing.storeSlug}/`));

      // The licence they agreed to is on the page, and so is the allowance.
      await expect(buyer.getByTestId("licence")).toContainText(licence);
      await expect(buyer.getByTestId("purchased-version")).toContainText("Version 1");
      await expect(buyer.getByTestId(`asset-remaining-${assetId}`))
        .toContainText("2 téléchargements restants");

      // ---- two downloads, then the third is refused ------------------------
      const first = await fetchAsset(buyer, listing, assetId);
      expect(first.status).toBe(200);
      expect(first.text, "the exact bytes the seller uploaded").toContain("version one");

      const second = await fetchAsset(buyer, listing, assetId);
      expect(second.status).toBe(200);

      const third = await fetchAsset(buyer, listing, assetId);
      expect(third.status, "the limit is enforced server-side").toBeGreaterThanOrEqual(400);
      expect(third.text).toContain("download_limit_reached");

      // The page agrees, and the button is no longer offered.
      await buyer.reload();
      await expect(buyer.getByTestId(`asset-remaining-${assetId}`))
        .toContainText("Limite de téléchargement atteinte");
      await expect(buyer.getByTestId(`asset-open-${assetId}`)).toBeDisabled();

      // And the log says exactly two, which is what the limit counted.
      expect(sql(`select count(*) from entitlement_downloads d
                   join digital_assets a on a.id = d.asset_id
                  where a.id = '${assetId}'::uuid`)).toBe("2");

      await buyerContext.close();
    });

  test("a new version does not change what an existing buyer owns",
    async ({ page, request, browser }) => {
      const listing = await sellerPublishes(page, { licence: "Termes v1.", downloadLimit: 5 });
      const v1Asset = sql(
        `select a.id from digital_assets a where a.product_id = '${listing.productId}'::uuid`);

      const buyerContext = await browser.newContext();
      const buyer = await buyerContext.newPage();
      await signIn(buyer, freshPhone());
      await buy(buyer, request, listing);

      // The seller uploads a correction and rewrites the terms, then publishes
      // it as a new version.
      await page.goto(`/fr/sell/${listing.storeSlug}`);
      await page.getByTestId(`asset-title-${listing.productId}`).fill("Le guide (corrigé)");
      await page.getByTestId(`asset-file-${listing.productId}`).setInputFiles({
        name: "guide2.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF_V2, "utf8"),
      });
      await page.getByTestId(`asset-submit-${listing.productId}`).click();
      await page.getByTestId(`licence-${listing.productId}`).fill("Termes v2, tout change.");
      await page.getByTestId(`save-licence-${listing.productId}`).click();
      await page.getByTestId(`publish-version-${listing.productId}`).click();
      await expect(page.getByTestId(`versions-${listing.productId}`)).toContainText("v2");

      // A new buyer would see the new terms.
      const fresh = await browser.newContext();
      const shopper = await fresh.newPage();
      await shopper.goto(`/fr/s/${listing.storeSlug}/${listing.productSlug}`);
      await expect(shopper.getByTestId("product-licence")).toContainText("Termes v2");
      await fresh.close();

      // The existing buyer keeps version 1, its file and its terms.
      await buyer.goto(`/fr/library/${listing.storeSlug}/${listing.productSlug}`);
      await expect(buyer.getByTestId("purchased-version")).toContainText("Version 1");
      await expect(buyer.getByTestId("licence")).toContainText("Termes v1.");
      await expect(buyer.getByTestId("licence")).not.toContainText("Termes v2");

      /*
       * The other half of the pinned-with-newer-versions-visible decision.
       *
       * The buyer must be TOLD that version 2 exists — without the notice they
       * cannot tell an out-of-date file from an abandoned product — and the
       * notice must say plainly that Afrinext does not hand it over. Both
       * halves are asserted here because either one alone is a different
       * product: the notice without the pin is an upgrade nobody agreed to,
       * and the pin without the notice is a silent staleness.
       */
      const notice = buyer.getByTestId("newer-version");
      await expect(notice, "the buyer is told a newer version exists").toBeVisible();
      await expect(notice).toContainText("2");
      await expect(notice, "and told it is not granted automatically")
        .toContainText("n'accorde pas automatiquement");

      // The same fact, on the library index, without leaving the pin behind.
      await buyer.goto("/fr/library");
      await expect(buyer.getByTestId("library-newer")).toContainText("2");
      await expect(buyer.getByTestId("library-item")).toContainText("Version 1");

      await buyer.goto(`/fr/library/${listing.storeSlug}/${listing.productSlug}`);
      const served = await fetchAsset(buyer, listing, v1Asset);
      expect(served.status).toBe(200);
      expect(served.text, "the bytes they paid for, unchanged").toContain("version one");

      // And cannot reach version 2's file, which they did not buy.
      const v2Asset = sql(
        `select a.id from digital_assets a
          where a.product_id = '${listing.productId}'::uuid and a.id <> '${v1Asset}'::uuid`);
      const forbidden = await fetchAsset(buyer, listing, v2Asset);
      expect(forbidden.status, "a version they did not pay for").toBeGreaterThanOrEqual(400);

      await buyerContext.close();
    });

  test("nobody else reaches the file: wrong buyer, unpaid, unpublished, suspended",
    async ({ page, request, browser }) => {
      const listing = await sellerPublishes(page, { licence: "L.", downloadLimit: 5 });
      const assetId = sql(
        `select a.id from digital_assets a where a.product_id = '${listing.productId}'::uuid`);

      // A real buyer, so there is something to steal.
      const buyerContext = await browser.newContext();
      const buyer = await buyerContext.newPage();
      await signIn(buyer, freshPhone());
      await buy(buyer, request, listing);
      expect((await fetchAsset(buyer, listing, assetId)).status).toBe(200);

      // ---- another signed-in person who bought nothing --------------------
      const intruderContext = await browser.newContext();
      const intruder = await intruderContext.newPage();
      await signIn(intruder, freshPhone());

      const stolen = await fetchAsset(intruder, listing, assetId);
      expect(stolen.status, "a real session is not a purchase").toBeGreaterThanOrEqual(400);

      // Their library stays empty — no cross-user leakage.
      await intruder.goto("/fr/library");
      await expect(intruder.getByTestId("library-item")).toHaveCount(0);

      // The library page for a product they do not own is a 404, not a 403:
      // knowing the URL is not an argument the server accepts.
      const page404 = await intruder.goto(
        `/fr/library/${listing.storeSlug}/${listing.productSlug}`, { waitUntil: "commit" });
      expect(page404?.status()).toBe(404);

      // ---- an order that was never paid -----------------------------------
      await intruder.goto(`/fr/s/${listing.storeSlug}/${listing.productSlug}`);
      await intruder.getByTestId("buy").click();
      await intruder.waitForURL(/\/fr\/orders\/[0-9a-f-]{36}$/);
      const unpaid = await fetchAsset(intruder, listing, assetId);
      expect(unpaid.status, "an order is not a purchase").toBeGreaterThanOrEqual(400);
      await intruderContext.close();

      // ---- the seller's own buyer-only endpoint ---------------------------
      const asSeller = await fetchAsset(page, listing, assetId);
      expect(asSeller.status,
        "the buyer path grants on payment, never on ownership").toBeGreaterThanOrEqual(400);

      // ---- the product unpublished ----------------------------------------
      sql(`update products set status = 'draft' where id = '${listing.productId}'::uuid`);
      const unpublished = await fetchAsset(buyer, listing, assetId);
      expect(unpublished.status, "a takedown reaches existing buyers too")
        .toBeGreaterThanOrEqual(400);
      await buyer.goto("/fr/library");
      await expect(buyer.getByTestId("library-item")).toHaveCount(0);
      sql(`update products set status = 'published' where id = '${listing.productId}'::uuid`);
      expect((await fetchAsset(buyer, listing, assetId)).status).toBe(200);

      // ---- the store suspended ---------------------------------------------
      sql(`update stores set status = 'suspended', suspended_at = now()
            where slug = '${listing.storeSlug}'`);
      const suspended = await fetchAsset(buyer, listing, assetId);
      expect(suspended.status, "a suspended store takes its files with it")
        .toBeGreaterThanOrEqual(400);
      await buyer.goto("/fr/library");
      await expect(buyer.getByTestId("library-item")).toHaveCount(0);

      await buyerContext.close();
    });

  test("a refunded buyer loses access, and the file is never a public URL",
    async ({ page, request, browser }) => {
      const listing = await sellerPublishes(page, { licence: "L.", downloadLimit: 5 });
      const assetId = sql(
        `select a.id from digital_assets a where a.product_id = '${listing.productId}'::uuid`);

      const buyerContext = await browser.newContext();
      const buyer = await buyerContext.newPage();
      await signIn(buyer, freshPhone());
      const orderId = await buy(buyer, request, listing);
      expect((await fetchAsset(buyer, listing, assetId)).status).toBe(200);

      /*
       * The storage key never leaves the server.
       *
       * Whatever the page contains, it must not be the internal path: a key on
       * the page is a URL somebody can share, and the whole access model rests
       * on there being no such thing.
       */
      const storageKey = sql(
        `select storage_key from digital_assets where id = '${assetId}'::uuid`);
      await buyer.goto(`/fr/library/${listing.storeSlug}/${listing.productSlug}`);
      expect(await buyer.content(), "the storage key must not reach the browser")
        .not.toContain(storageKey);

      // ---- the refund, through the existing domain -------------------------
      sql(`update entitlements set revoked_at = now(), revoked_reason = 'refund.succeeded'
            where order_id = '${orderId}'::uuid`);

      const afterRefund = await fetchAsset(buyer, listing, assetId);
      expect(afterRefund.status, "a repaid buyer is no longer entitled")
        .toBeGreaterThanOrEqual(400);
      await buyer.goto("/fr/library");
      await expect(buyer.getByTestId("library-item")).toHaveCount(0);

      await buyerContext.close();
    });
});
