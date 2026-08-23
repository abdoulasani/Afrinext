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

  // A new account is `pending_consent`: the session exists and grants nothing
  // until the general terms are accepted. This is part of signing up now.
  //
  // Wait for whichever arrives — a brand-new number gets the consent step, a
  // returning one goes straight through. Polling isVisible() right after the
  // click is a race: the panel has not rendered yet, so it reads false and the
  // step is silently skipped.
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
    await expect(page.getByTestId("wizard-next")).toHaveCount(0);

    // Nor by typing the wizard's URL, which is the whole point of not merely
    // hiding the link.
    await page.goto("/fr/sell/nouvelle");
    await page.waitForURL(/\/fr\/sell$/);

    // And the SERVER refuses too, not just the screen. A hidden form is not a
    // permission: this posts straight to the endpoint the form would post to.
    // Without this assertion, dropping the authorize() call in createStore
    // leaves every test green — verified by doing exactly that.
    const refused = await apiPost(page, "/api/v1/stores", {
      name: "Sneaky Store", storeType: "digital_product",
    });
    expect(refused.status, "a non-seller must be refused by the API").toBe(403);
    expect((refused.body as { error: { code: string } }).error.code).toBe("authz.denied");
    expect(sqlOne("select count(*) from stores where name = 'Sneaky Store'")).toBe("0");

    /*
     * And a request with a perfectly invalid body is STILL 403, not 400.
     *
     * That ordering is the assertion: permission is decided before the body is
     * judged, so a stranger is never told which fields the endpoint wants or
     * which store types exist. Reversing the two — validating first — turns
     * this into a 400 and hands out a fact they had not earned.
     */
    const alsoRefused = await apiPost(page, "/api/v1/stores", { storeType: "not_a_type" });
    expect(alsoRefused.status, "permission answers before validation").toBe(403);

    grantSeller(userId);

    // 1. Holding the role is still not enough: the seller terms must be
    //    accepted first.
    await page.goto("/fr/sell");
    await expect(page.getByTestId("consent-gate")).toBeVisible();
    await page.getByTestId("consent-accept").click();
    await expect(page.getByTestId("consent-gate")).toHaveCount(0);

    // 2. Now open a store, through the four-step wizard.
    await page.goto("/fr/sell/nouvelle");

    //    Step 1 — the trade. Nothing may continue until one is chosen, which is
    //    what makes `store_type` a real answer rather than a silent default.
    await expect(page.getByTestId("wizard-next")).toBeDisabled();
    //    Six choices, one per store type, and each is a real radio with a real
    //    accessible name. The input is visually hidden so the whole card can be
    //    the target, which is only acceptable if a screen reader still gets a
    //    labelled radio group — so that is asserted rather than assumed.
    await expect(page.getByRole("radio")).toHaveCount(6);
    await expect(page.getByRole("radio", { name: /Produits numériques/ })).toHaveCount(1);
    await page.getByTestId("wizard-type-digital_product").click();
    await page.getByTestId("wizard-next").click();

    //    Step 2 — identity. The slug is derived from the name server-side; the
    //    wizard never asks for one and never sends one.
    await page.locator("#store-name").fill(storeSlug);
    await page.locator("#store-tagline").fill("Guides pratiques");
    await page.getByTestId("wizard-brand-indigo").click();
    await page.getByTestId("wizard-next").click();

    //    Step 3 — where. Optional, so it is skipped except for the city.
    await page.locator("#store-city").fill("Niamey");
    await page.getByTestId("wizard-next").click();

    //    Step 4 — the preview shows the real store, then submits.
    await expect(page.getByRole("heading", { name: storeSlug })).toBeVisible();
    await page.getByTestId("wizard-submit").click();
    await page.waitForURL(new RegExp(`/fr/sell/${storeSlug}$`));

    // The type and the brand are the ones that were chosen, not defaults that
    // happened to match. Read from the database, not from the screen.
    expect(
      sqlOne(`select store_type || ' ' || brand from stores where slug = '${storeSlug}'`),
    ).toBe("digital_product indigo");

    /*
     * 3. The storefront comes first, and it may be published EMPTY.
     *
     *    A store is a commercial identity, so a seller can claim their public
     *    address and share it while they are still preparing what they will
     *    sell. The dashboard says so — "publish the store" is the next step on
     *    a store with nothing in it.
     */
    await expect(page.getByText("Publiez votre boutique")).toBeVisible();
    await page.getByRole("button", { name: "Publier la boutique" }).click();
    await expect(page.getByRole("link", { name: "Voir la page publique" }).first()).toBeVisible();
    expect(
      sqlOne(`select status from stores where slug = '${storeSlug}'`),
      "published with zero offerings",
    ).toBe("published");
    expect(
      sqlOne(`select count(*) from products p join stores s on s.id = p.store_id
               where s.slug = '${storeSlug}'`),
      "and publishing invented no product",
    ).toBe("0");

    /*
     * 4. An anonymous visitor can already reach it, and is told the truth:
     *    the store exists, and it has nothing for sale yet. No placeholder
     *    product, no fabricated price, no "coming soon" item in the list.
     */
    const emptyContext = await browser.newContext();
    const emptyVisitor = await emptyContext.newPage();
    const emptyResponse = await emptyVisitor.goto(`/fr/s/${storeSlug}`);
    expect(emptyResponse?.status(), "an empty published store is public").toBe(200);
    await expect(emptyVisitor.getByText("Aucune offre pour l'instant")).toBeVisible();
    await expect(emptyVisitor.getByText("prépare actuellement ses offres")).toBeVisible();
    const emptyBody = await emptyVisitor.locator("body").innerText();
    expect(emptyBody, "no invented price on an empty storefront").not.toMatch(/XOF/);
    await emptyContext.close();

    // 5. Now add a paid digital product. 15 000 XOF, typed the way a person types it.
    await page.locator('input[name="title"]').fill("Guide de Niamey");
    await page.locator('input[name="summary"]').fill("Un guide pratique");
    await page.locator('input[name="price"]').fill("15 000");
    await page.getByRole("button", { name: "Ajouter un produit", exact: true }).click();
    await expect(page.getByText("Guide de Niamey")).toBeVisible();

    // The price is whole francs, because XOF has zero decimals. Read straight
    // from the database: a 100× error would show as 1500000 here.
    const storedMinor = sqlOne(
      `select p.price_minor from products p join stores s on s.id = p.store_id
        where s.slug = '${storeSlug}' and p.slug = '${productSlug}'`,
    );
    expect(storedMinor).toBe("15000");

    // 6. Before the PRODUCT is published, its public URL must not exist.
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    const early = await visitor.goto(`/fr/s/${storeSlug}/${productSlug}`);
    expect(early?.status(), "a draft product must not be reachable").toBe(404);

    // 7. Publish it.
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await expect(page.getByRole("link", { name: "Voir la page publique" })).toHaveCount(2);

    // 8. The anonymous visitor — no cookies, no session — reaches the URL.
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
