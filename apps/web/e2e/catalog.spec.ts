import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SERVER_LOG } from "../playwright.config";

/**
 * The milestone 2 journey, end to end in a real browser.
 *
 *   seller signs in → creates a store → publishes it → creates a paid digital
 *   product → publishes it → an ANONYMOUS visitor reaches its public URL and
 *   sees the title and the XOF price.
 *
 * The anonymous half runs in a separate browser context with no cookies, so
 * "the public can see this" is proved by an actual public request rather than
 * by a signed-in page that happens to look public.
 */

const DB = process.env["DATABASE_URL"] ?? "";

function sqlOne(statement: string): string {
  return execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" }).trim();
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
}

function freshPhone(): string {
  return `+22790${String(Math.floor(100000 + Math.random() * 899999))}`;
}

function logLength(): number {
  try {
    return readFileSync(SERVER_LOG, "utf8").length;
  } catch {
    return 0;
  }
}

async function codeSentTo(phone: string, since: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  const wanted = new RegExp(`would send to \\${phone}: Afrinext: (\\d{6})`);
  while (Date.now() < deadline) {
    let log = "";
    try {
      log = readFileSync(SERVER_LOG, "utf8").slice(since);
    } catch { /* not written yet */ }
    const match = wanted.exec(log);
    if (match?.[1] !== undefined) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification code was sent to ${phone} within 15s.`);
}

/**
 * Posts from inside the page, so the request carries the real session cookie.
 * (The cookie is Secure, and Playwright's request context will not attach a
 * Secure cookie over http — see the authorization spec.)
 */
async function apiPost(
  page: Page,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ([target, payload]) => {
      const response = await fetch(target as string, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    },
    [path, body] as [string, unknown],
  );
}

/** Signs in and returns the Afrinext user id the session resolves to. */
async function signIn(page: Page, phone: string): Promise<string> {
  await page.goto("/fr/sign-in");
  const before = logLength();
  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();
  await page.locator('input[inputmode="numeric"]').fill(await codeSentTo(phone, before));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/wallet$/);

  return sqlOne(
    `select u.id from users u join "user" au on au.id = u.auth_user_id
      where au."phoneNumber" = '${phone}'`,
  );
}

/** Grants the global `seller` role, which is what an admin console would do. */
function grantSeller(userId: string): void {
  execFileSync("psql", [DB, "-Atc",
    `insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
     select gen_random_uuid(), '${userId}'::uuid, r.id, 'global', null
       from roles r where r.key = 'seller'`], { encoding: "utf8" });
}

test.describe("a seller publishes a digital product, and the public can see it", () => {
  test("the whole journey, then an anonymous visitor", async ({ page, browser }) => {
    const phone = freshPhone();
    const storeSlug = unique("boutique");
    const productSlug = "guide-de-niamey";

    const userId = await signIn(page, phone);

    // Before the grant, the seller screen offers nothing: `store.create` exists
    // as a permission but no role a new account holds carries it.
    await page.goto("/fr/sell");
    await expect(page.getByText("Votre compte n'a pas encore l'autorisation")).toBeVisible();
    await expect(page.locator('input[name="name"]')).toHaveCount(0);

    // And the SERVER refuses too, not just the screen. A hidden form is not a
    // permission: this posts straight to the endpoint the form would post to.
    // Without this assertion, dropping the authorize() call in createStore
    // leaves every test green — verified by doing exactly that.
    const refused = await apiPost(page, "/api/v1/stores", { name: "Sneaky Store" });
    expect(refused.status, "a non-seller must be refused by the API").toBe(403);
    expect((refused.body as { error: { code: string } }).error.code).toBe("authz.denied");
    expect(sqlOne("select count(*) from stores where name = 'Sneaky Store'")).toBe("0");

    grantSeller(userId);

    // 1. Create the store.
    await page.goto("/fr/sell");
    await page.locator('input[name="name"]').fill(storeSlug);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(new RegExp(`/fr/sell/${storeSlug}$`));

    // 2. Publishing the product must be impossible while the store is a draft,
    //    so the store is published first — which is also the seller's real order
    //    of operations.
    await page.getByRole("button", { name: "Publier la boutique" }).click();
    await expect(page.getByRole("link", { name: "Voir la page publique" }).first()).toBeVisible();

    // 3. Create a paid digital product. 15 000 XOF, typed the way a person types it.
    await page.locator('input[name="title"]').fill("Guide de Niamey");
    await page.locator('input[name="summary"]').fill("Un guide pratique");
    await page.locator('input[name="price"]').fill("15 000");
    await page.getByRole("button", { name: "Ajouter un produit numérique" }).click();
    await expect(page.getByText("Guide de Niamey")).toBeVisible();

    // The price is whole francs, because XOF has zero decimals. Read straight
    // from the database: a 100× error would show as 1500000 here.
    const storedMinor = sqlOne(
      `select p.price_minor from products p join stores s on s.id = p.store_id
        where s.slug = '${storeSlug}' and p.slug = '${productSlug}'`,
    );
    expect(storedMinor).toBe("15000");

    // 4. Before publishing, the public URL must not exist.
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    const early = await visitor.goto(`/fr/s/${storeSlug}/${productSlug}`);
    expect(early?.status(), "a draft product must not be reachable").toBe(404);

    // 5. Publish it.
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await expect(page.getByRole("link", { name: "Voir la page publique" })).toHaveCount(2);

    // 6. The anonymous visitor — no cookies, no session — reaches the URL.
    const response = await visitor.goto(`/fr/s/${storeSlug}/${productSlug}`);
    expect(response?.status()).toBe(200);

    await expect(visitor.getByRole("heading", { name: "Guide de Niamey" })).toBeVisible();
    await expect(visitor.getByText("Un guide pratique")).toBeVisible();

    // 15 000 XOF with a narrow no-break space, and no decimal part at all.
    const price = await visitor.getByTestId("product-price").innerText();
    expect(price).toMatch(/^15 000 XOF$/);

    // Nothing private is on the page: not the seller's user id, not the store
    // or product id, not the phone number that signed in.
    const body = await visitor.locator("body").innerText();
    const html = await visitor.content();
    for (const secret of [userId, phone]) {
      expect(html, `the public page must not contain ${secret}`).not.toContain(secret);
    }
    expect(body).not.toContain("Brouillon");

    // The store page lists it too, still anonymously.
    await visitor.goto(`/fr/s/${storeSlug}`);
    await expect(visitor.getByText("Guide de Niamey")).toBeVisible();

    await anonymous.close();
  });

  test("an anonymous visitor cannot reach the seller screens", async ({ page }) => {
    const response = await page.goto("/fr/sell", { waitUntil: "commit" });
    // Redirected to sign-in rather than rendering a seller's tools.
    await page.waitForURL(/\/sign-in/);
    expect(response).toBeTruthy();
  });
});
