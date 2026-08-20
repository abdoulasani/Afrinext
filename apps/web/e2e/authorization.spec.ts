import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { SERVER_LOG } from "../playwright.config";

/**
 * The three assertions Phase 1 left resting on manual verification.
 *
 *   1. an unauthenticated request to a protected route is refused with 401;
 *   2. an authenticated ORDINARY MEMBER is refused an admin route with 403;
 *   3. the real sign-in journey completes.
 *
 * Assertion 2 is the reason this file exists. Authentication succeeding and
 * granting nothing is the load-bearing claim of the whole authorization model,
 * and until now nothing executed it.
 */

/** A fresh number per run: one live challenge per identifier is a hard rule. */
function freshPhone(): string {
  return `+22790${String(Math.floor(100000 + Math.random() * 899999))}`;
}

/**
 * Reads the code out of the server's own output.
 *
 * There is no database read here on purpose. Since review decision 1 the code
 * exists only as a keyed hash in `otp_challenges`, so a test that could look it
 * up in PostgreSQL would be evidence that the correction had been undone.
 */
async function codeSentTo(phone: string, since: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  const wanted = new RegExp(`would send to \\${phone}: Afrinext: (\\d{6})`);
  while (Date.now() < deadline) {
    let log = "";
    try {
      log = readFileSync(SERVER_LOG, "utf8").slice(since);
    } catch {
      // The server may not have written anything yet.
    }
    const match = wanted.exec(log);
    if (match?.[1] !== undefined) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification code was sent to ${phone} within 15s.`);
}

function logLength(): number {
  try {
    return readFileSync(SERVER_LOG, "utf8").length;
  } catch {
    return 0;
  }
}

/**
 * Makes the request from inside the page, not from Playwright's API context.
 *
 * Sessions are cookie-backed and the cookie is marked `Secure` (the app sets
 * that whenever NODE_ENV is production, which `next start` is). Playwright's
 * own request context declines to attach a Secure cookie over http, so it would
 * report 401 for a perfectly valid session — and a test that cannot tell a
 * refused session from an absent one proves nothing about authorization.
 *
 * Running fetch inside the page uses the browser's real cookie jar on a real
 * origin, which is what the application actually faces.
 */
async function apiGet(
  page: Page,
  path: string,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return { status: response.status, body: await response.json() };
  }, path);
}

/** Drives the real sign-in UI and leaves the page holding a real session. */
async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto("/fr/sign-in");
  const before = logLength();

  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('button[type="submit"]').click();

  // The form advances only once the server has accepted the request, so this
  // also asserts that issuing a code works at all.
  await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();

  const code = await codeSentTo(phone, before);
  await page.locator('input[inputmode="numeric"]').fill(code);
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
}

test.describe("authorization, in a real browser against a real build", () => {
  test("refuses an unauthenticated request with 401", async ({ page }) => {
    // A brand-new context: no cookie, no session, nothing to resolve an actor
    // from. Every protected route must refuse, not just the admin one.
    await page.goto("/fr/sign-in");
    for (const route of ["/api/v1/me", "/api/v1/wallet", "/api/v1/admin/ledger"]) {
      const response = await apiGet(page, route);
      expect(response.status, `${route} unauthenticated`).toBe(401);
      expect((response.body as { error: { code: string } }).error.code).toBe("auth.required");
    }
  });

  test("refuses an ordinary member the admin ledger with 403", async ({ page }) => {
    const phone = freshPhone();
    await signIn(page, phone);

    // FIRST prove the session is real and the actor resolves. Without this, a
    // 403 below would be indistinguishable from a broken or empty session —
    // the test would pass for entirely the wrong reason, which is exactly the
    // failure Phase 1's mutation testing found in two other tests.
    const me = await apiGet(page, "/api/v1/me");
    expect(me.status, "the signed-in session must be live").toBe(200);
    const identity = (me.body as { data: { userId: string; permissions: string[] } }).data;
    expect(identity.userId).toBeTruthy();
    expect(identity.permissions).toContain("wallet.read_own");

    // A new account is granted `member` and nothing more, so the permission the
    // admin route needs is one this actor genuinely does not hold.
    expect(identity.permissions).not.toContain("ledger.read");

    // The same live session, on an admin route.
    const denied = await apiGet(page, "/api/v1/admin/ledger");
    expect(denied.status, "an ordinary member on the admin ledger").toBe(403);

    const body = denied.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("authz.denied");
    // The message names the permission and the scope: a denial nobody can
    // diagnose becomes a denial someone works around.
    expect(body.error.message).toContain("ledger.read");

    // And a route the member IS entitled to still answers, so the 403 is the
    // authorization decision rather than a blanket refusal.
    expect((await apiGet(page, "/api/v1/wallet")).status).toBe(200);
  });

  test("completes the real sign-in journey", async ({ page }) => {
    const phone = freshPhone();
    await signIn(page, phone);

    // The wallet renders, in French, with a zero-decimal amount — XOF has no
    // minor unit, so "0,00 XOF" here would mean the exponent was assumed.
    await expect(page.getByText("SOLDE DISPONIBLE")).toBeVisible();
    await expect(page.getByText("0 XOF").first()).toBeVisible();

    // The ledger records entitlement, not custody. No screen may say otherwise.
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of ["dépôt", "depot", "fonds protégés", "deposit"]) {
      expect(body, `the wallet must not describe entitlements as "${forbidden}"`)
        .not.toContain(forbidden);
    }

    // Signed out, the same route redirects to sign-in rather than rendering.
    await page.context().clearCookies();
    const anonymous = await page.request.get("/fr/wallet", { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
  });
});
