import { chromium, request as pwRequest } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const OUT = process.argv[2];
const BASE = "http://127.0.0.1:3200";
const DB = process.env.DATABASE_URL;
const LOG = "/tmp/serve.log";
const SECRET = "dev-mock-webhook-secret";
const sql = (s) => (execFileSync("psql", [DB, "-Atc", s], { encoding: "utf8" }).split("\n")[0] ?? "").trim();
const phone = () => `+22790${Math.floor(100000 + Math.random() * 899999)}`;

function logLen() { try { return readFileSync(LOG, "utf8").length; } catch { return 0; } }
async function codeFor(p, since) {
  const want = new RegExp(`would send to \\${p}: Afrinext: (\\d{6})`);
  for (let i = 0; i < 80; i++) {
    const m = want.exec(readFileSync(LOG, "utf8").slice(since));
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no code");
}
async function signIn(page, p) {
  await page.goto(BASE + "/fr/sign-in");
  const before = logLen();
  await page.locator('input[type="tel"]').fill(p);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[inputmode="numeric"]').waitFor();
  await page.locator('input[inputmode="numeric"]').fill(await codeFor(p, before));
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
               where au."phoneNumber" = '${p}'`);
}

const browser = await chromium.launch();
const seller = await browser.newContext({ viewport: { width: 390, height: 844 } });
const sp = await seller.newPage();

const existing = sql(`select status from stores where slug = 'sahel-data-guides'`);
if (existing !== "published") {
  throw new Error("fixture store missing; run the full build first");
}
const slug = "sahel-data-guides";
const productId = sql(`select p.id from products p join stores s on s.id=p.store_id
                        where s.slug='${slug}' and p.slug='cahier-de-caisse'`);
// Sign in as the store's owner so the seller screenshots are authentic.
const ownerPhone = sql(`select au."phoneNumber" from stores s
                          join users u on u.id = s.owner_user_id
                          join "user" au on au.id = u.auth_user_id
                         where s.slug = '${slug}'`);
await signIn(sp, ownerPhone);

// The seller's delivery controls, desktop.
const wide = await browser.newContext({ viewport: { width: 1280, height: 900 },
  storageState: await seller.storageState() });
const wp = await wide.newPage();
await wp.goto(BASE + `/fr/sell/${slug}`);
await wp.waitForTimeout(700);
await wp.screenshot({ path: `${OUT}/p5-seller.png`, fullPage: true });

// The public product page, with the licence before purchase.
const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
const ap = await anon.newPage();
await ap.goto(BASE + `/fr/s/${slug}/cahier-de-caisse`);
await ap.waitForTimeout(600);
await ap.screenshot({ path: `${OUT}/p5-product.png`, fullPage: true });
await anon.close();

// ---- the buyer ----
const buyerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const bp = await buyerCtx.newPage();
await signIn(bp, phone());
await bp.goto(BASE + `/fr/s/${slug}/cahier-de-caisse`);
await bp.getByTestId("buy").click();
await bp.waitForURL(/\/fr\/orders\/[0-9a-f-]{36}$/);
// The profile and the channel, through the same helpers the suite uses.
await bp.getByTestId("profile-gate").waitFor();
await bp.getByTestId("profile-name").fill("Aïcha Souley");
await bp.getByTestId("profile-country").selectOption("NE");
await bp.getByTestId("profile-save").click();
await bp.getByTestId("pay").waitFor();
await bp.getByTestId("channel-mobile_money").check();
await bp.getByTestId("pay").click();
await bp.getByTestId("payment-status").waitFor();

const orderId = (/orders\/([0-9a-f-]{36})/.exec(bp.url()) ?? [])[1];
const providerRef = sql(`select provider_ref from payments where order_id = '${orderId}'::uuid`);
const payload = JSON.stringify({
  id: "evt-" + Date.now(), type: "charge.succeeded", providerRef,
  status: "succeeded", amountMinor: "3500", currency: "XOF",
});
const api = await pwRequest.newContext({ baseURL: BASE });
const res = await api.post("/api/v1/payments/webhook", {
  headers: {
    "content-type": "application/json",
    "x-mock-signature": createHmac("sha256", SECRET).update(Buffer.from(payload, "utf8")).digest("hex"),
  },
  data: payload,
});
console.log("webhook:", res.status());

await bp.goto(BASE + "/fr/library");
await bp.waitForTimeout(700);
await bp.screenshot({ path: `${OUT}/p5-library.png`, fullPage: true });

await bp.goto(BASE + `/fr/library/${slug}/cahier-de-caisse`);
await bp.waitForTimeout(700);
await bp.screenshot({ path: `${OUT}/p5-owned.png`, fullPage: true });

const wideBuyer = await browser.newContext({ viewport: { width: 1280, height: 900 },
  storageState: await buyerCtx.storageState() });
const wb = await wideBuyer.newPage();
await wb.goto(BASE + "/fr/library");
await wb.waitForTimeout(700);
await wb.screenshot({ path: `${OUT}/p5-library-desktop.png`, fullPage: true });

console.log("fixture ready:", slug, "product", productId);
await browser.close();
