import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/** What one download attempt tells us. */
interface Served {
  status: number;
  text: string;
  type: string;
  disposition: string;
}
import {
  BASE_URL_A, BASE_URL_B, E2E_BUCKET, E2E_ENDPOINT_HOST, MOCK_WEBHOOK_SECRET, REAL_BUCKET,
  SERVER_LOG,
} from "../playwright.config";
import { completeBuyerProfile, chooseMobileMoney } from "./buyer-profile";
import { createStoreViaWizard } from "./store-wizard";

/**
 * Two application instances, one bucket.
 *
 * This is the milestone's actual claim, so it is tested the way the claim is
 * made: a seller uploads a file through instance A's real screens, and a buyer
 * downloads it through instance B's real screens — two separate `next start`
 * processes on different ports, sharing only the database and the object store.
 *
 * Neither instance is given a content directory, so anything served here came
 * out of the bucket. Against the filesystem adapter this test cannot pass at
 * all unless the two processes happen to share a disk, which is precisely the
 * limitation the milestone removes.
 *
 * The bucket verifies the SigV4 signature of every request, so "the upload
 * reached storage" also means "the adapter signed correctly".
 */

const DB = process.env["DATABASE_URL"] ?? "";
const PDF = "%PDF-1.7\nles bytes du vendeur\n%%EOF\n";
const PDF_V2 = "%PDF-1.7\nla correction du vendeur\n%%EOF\n";
const A = BASE_URL_A;
const B = BASE_URL_B;

const sql = (s: string): string =>
  (execFileSync("psql", [DB, "-Atc", s], { encoding: "utf8" }).split("\n")[0] ?? "").trim();
const unique = (p: string): string =>
  `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
const freshPhone = (): string => `+22790${String(Math.floor(100000 + Math.random() * 899999))}`;
const logLength = (): number => {
  try { return readFileSync(SERVER_LOG, "utf8").length; } catch { return 0; }
};

/**
 * The code, from whichever instance sent it.
 *
 * Both write to their own log, so the reader watches all three files rather
 * than assuming which process handled the sign-in.
 */
async function codeSentTo(phone: string, since: number): Promise<string> {
  const deadline = Date.now() + 20_000;
  const wanted = new RegExp(`would send to \\${phone}: Afrinext: (\\d{6})`);
  const logs = [SERVER_LOG, ".e2e/server-s3-a.log", ".e2e/server-s3-b.log"];
  while (Date.now() < deadline) {
    for (const file of logs) {
      let text = "";
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      const slice = file === SERVER_LOG ? text.slice(since) : text;
      const match = [...slice.matchAll(new RegExp(wanted, "g"))].pop();
      if (match?.[1] !== undefined) return match[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No verification code was sent to ${phone}.`);
}

async function signIn(page: Page, base: string, phone: string): Promise<string> {
  await page.goto(`${base}/fr/sign-in`);
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

test.describe("two instances, one bucket", () => {
  test.beforeAll(() => {
    // Says which bucket this run proved something about. A green run against
    // the fixture and a green run against R2 are different facts, and the
    // report should never have to guess which one it is looking at.
    console.log(REAL_BUCKET
      ? `object-storage spec: REAL bucket "${E2E_BUCKET}" at ${E2E_ENDPOINT_HOST}`
      : `object-storage spec: in-repo fixture bucket "${E2E_BUCKET}"`);
  });

  test("a seller uploads on instance A and a buyer downloads on instance B",
    async ({ browser, request }) => {
      test.setTimeout(180_000);

      // ---------- instance A: the seller ----------
      const sellerCtx = await browser.newContext();
      const seller = await sellerCtx.newPage();
      const storeSlug = unique("depot");
      const sellerId = await signIn(seller, A, freshPhone());
      execFileSync("psql", [DB, "-Atc",
        `insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
         select gen_random_uuid(), '${sellerId}'::uuid, r.id, 'global', null
           from roles r where r.key = 'seller'`]);

      await seller.goto(`${A}/fr/sell`);
      await seller.getByTestId("consent-accept").click();
      await createStoreViaWizard(seller, { slug: storeSlug, base: A });
      await seller.getByRole("button", { name: "Publier la boutique" }).click();
      await expect(seller.getByRole("link", { name: "Voir la page publique" }).first())
        .toBeVisible();

      await seller.locator('input[name="title"]').fill("Fichier partagé");
      await seller.locator('input[name="price"]').fill("15 000");
      await seller.getByRole("button", { name: "Ajouter un produit", exact: true }).click();
      const productId = sql(
        `select p.id from products p join stores s on s.id = p.store_id
          where s.slug = '${storeSlug}' and p.slug = 'fichier-partage'`);
      expect(productId, "the product must exist").not.toBe("");

      await seller.getByTestId(`asset-title-${productId}`).fill("Le fichier (PDF)");
      await seller.getByTestId(`asset-file-${productId}`).setInputFiles({
        name: "partage.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF, "utf8"),
      });
      await seller.getByTestId(`asset-submit-${productId}`).click();
      await expect(seller.getByText("Le fichier (PDF)")).toBeVisible();

      // Two downloads, set through the seller's own control. An explicit small
      // limit is what makes exhaustion observable later; leaving the default
      // would test nothing and read as if it had.
      await seller.getByTestId(`limit-${productId}`).fill("2");
      await seller.getByTestId(`save-limit-${productId}`).click();
      await expect(seller.getByTestId(`limit-${productId}`)).toHaveValue("2");

      await seller.getByRole("button", { name: "Publier", exact: true }).click();
      await expect(seller.getByRole("link", { name: "Voir la page publique" }))
        .toHaveCount(2);
      // The seller's session stays open: the version-pinning check below needs
      // the store's actual owner to upload a second version, and a fresh
      // sign-in would be a different person who owns nothing.

      // ---------- instance B: the buyer ----------
      const buyerCtx = await browser.newContext();
      const buyer = await buyerCtx.newPage();
      await signIn(buyer, B, freshPhone());

      await buyer.goto(`${B}/fr/s/${storeSlug}/fichier-partage`);
      await buyer.getByTestId("buy").click();
      await buyer.waitForURL(/\/fr\/orders\/[0-9a-f-]{36}$/);
      await completeBuyerProfile(buyer);
      await chooseMobileMoney(buyer);
      await buyer.getByTestId("pay").click();
      await expect(buyer.getByTestId("payment-status")).toHaveText("pending");

      const orderId = (/orders\/([0-9a-f-]{36})/.exec(buyer.url()) ?? [])[1] as string;
      const providerRef = sql(
        `select provider_ref from payments where order_id = '${orderId}'::uuid`);
      const payload = JSON.stringify({
        id: unique("evt"), type: "charge.succeeded", providerRef,
        status: "succeeded", amountMinor: "15000", currency: "XOF",
      });
      const confirmed = await request.post(`${B}/api/v1/payments/webhook`, {
        headers: {
          "content-type": "application/json",
          "x-mock-signature": createHmac("sha256", MOCK_WEBHOOK_SECRET)
            .update(Buffer.from(payload, "utf8")).digest("hex"),
        },
        data: payload,
      });
      expect(confirmed.status()).toBe(200);

      // The bytes, fetched through instance B, out of the bucket instance A
      // wrote to.
      const assetId = sql(
        `select a.id from digital_assets a where a.product_id = '${productId}'::uuid`);
      const download = (page: Page, asset: string): Promise<Served> =>
        page.evaluate(async ([store, product, id]) => {
          const minted = await fetch(`/api/v1/library/${store}/${product}/access`, {
            method: "POST", credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assetId: id, disposition: "attachment" }),
          });
          // The refusal body, not just its status: a bare 403 in a failure
          // message costs a debugging round trip, and the domain answers with a
          // code that names which check said no.
          if (!minted.ok) {
            return { status: minted.status, text: await minted.text(), type: "", disposition: "" };
          }
          const body = (await minted.json()) as { data: { url: string } };
          const response = await fetch(body.data.url, { credentials: "same-origin" });
          return {
            status: response.status,
            text: await response.text(),
            type: response.headers.get("content-type") ?? "",
            disposition: response.headers.get("content-disposition") ?? "",
          };
        }, [storeSlug, "fichier-partage", asset] as [string, string, string]);

      const served = await download(buyer, assetId);

      expect(served.status, "instance B serves a file it never had on disk").toBe(200);
      expect(served.text, "byte-for-byte what the seller uploaded elsewhere")
        .toContain("les bytes du vendeur");
      expect(served.type, "the seller's content type survived the bucket")
        .toContain("application/pdf");
      expect(served.disposition, "and it arrives as a download, named from the title")
        .toMatch(/^attachment; filename="Le fichier PDF"/);

      // ---------- and the storage key never reaches the browser ----------
      const storageKey = sql(
        `select storage_key from digital_assets where id = '${assetId}'::uuid`);
      expect(storageKey, "the key exists server-side").not.toBe("");
      for (const url of [
        `${B}/fr/library/${storeSlug}/fichier-partage`,
        `${B}/fr/s/${storeSlug}/fichier-partage`,
      ]) {
        await buyer.goto(url);
        const html = await buyer.content();
        expect(html, `${url} must not contain the storage key`).not.toContain(storageKey);
        expect(html, "nor the bucket").not.toContain(E2E_BUCKET);
        expect(html, "nor the endpoint").not.toContain(E2E_ENDPOINT_HOST);
      }

      // ---------- a stranger on instance B still gets nothing ----------
      const strangerCtx = await browser.newContext();
      const stranger = await strangerCtx.newPage();
      await signIn(stranger, B, freshPhone());
      const refused = await stranger.evaluate(async ([store, product, asset]) => {
        const minted = await fetch(`/api/v1/library/${store}/${product}/access`, {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetId: asset, disposition: "attachment" }),
        });
        return minted.status;
      }, [storeSlug, "fichier-partage", assetId] as [string, string, string]);
      expect(refused, "object storage changes nothing about who may read")
        .toBeGreaterThanOrEqual(400);
      await strangerCtx.close();

      // ---------- the download limit is counted, across instances ----------
      //
      // The limit was two. One download has been spent. The second must work
      // and the third must not — and the counting happens in the database, so
      // it holds even though the bytes came from a bucket both machines share.
      const second = await download(buyer, assetId);
      expect(second.status, "the second download is within the allowance").toBe(200);
      expect(second.text).toContain("les bytes du vendeur");

      const third = await download(buyer, assetId);
      expect(third.status, "the third is refused — 429, an exhausted allowance")
        .toBe(429);
      expect(third.text, "and says so specifically, to the person it belongs to")
        .toContain("download_limit");

      // ---------- version pinning, across the two machines ----------
      //
      // The seller uploads a corrected file on instance A and publishes it. The
      // buyer paid for v1 and must still be served v1's bytes — out of the same
      // bucket that now holds both versions.
      await seller.goto(`${A}/fr/sell/${storeSlug}`);
      await seller.getByTestId(`asset-title-${productId}`).fill("Le fichier (corrigé)");
      await seller.getByTestId(`asset-file-${productId}`).setInputFiles({
        name: "corrige.pdf", mimeType: "application/pdf",
        buffer: Buffer.from(PDF_V2, "utf8"),
      });
      await seller.getByTestId(`asset-submit-${productId}`).click();
      await expect(seller.getByText("Le fichier (corrigé)")).toBeVisible();
      await seller.getByTestId(`publish-version-${productId}`).click();
      await expect(seller.getByText("Le fichier (corrigé)")).toBeVisible();

      const v2Asset = sql(
        `select a.id from digital_assets a
           join product_versions v on v.id = a.version_id
          where a.product_id = '${productId}'::uuid
          order by v.version_no desc, a.created_at desc limit 1`);
      expect(v2Asset, "a second version exists now").not.toBe(assetId);

      // Raise the allowance, so what follows is answered by the version rules
      // rather than by a limit that has nothing to do with them.
      execFileSync("psql", [DB, "-Atc",
        `update products set download_limit = 9 where id = '${productId}'::uuid`]);

      const pinned = await download(buyer, assetId);
      expect(pinned.status, "the version paid for is still served").toBe(200);
      expect(pinned.text, "and it is v1's bytes, not the newest upload")
        .toContain("les bytes du vendeur");
      expect(pinned.text, "the corrected file is not what they get")
        .not.toContain("la correction du vendeur");

      const notOwned = await download(buyer, v2Asset);
      expect(notOwned.status, "and the new version's file is not theirs to take")
        .toBe(403);

      // ---------- a suspended store takes the file back ----------
      //
      // The bucket still holds the object and the entitlement row still exists.
      // The refusal has to come from the chain, which is the point: storage
      // never became the thing that decides.
      execFileSync("psql", [DB, "-Atc",
        `update stores set status = 'suspended' where slug = '${storeSlug}'`]);
      const suspended = await download(buyer, assetId);
      expect(suspended.status, "a suspended store is not a source of downloads")
        .toBe(403);
      execFileSync("psql", [DB, "-Atc",
        `update stores set status = 'published' where slug = '${storeSlug}'`]);
      expect((await download(buyer, assetId)).status,
        "and lifting the suspension restores it, so the refusal was the store")
        .toBe(200);

      await buyerCtx.close();
      await sellerCtx.close();
    });
});
