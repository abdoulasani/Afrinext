import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SERVER_LOG } from "../playwright.config";

/**
 * The email and password journey, in a real browser against a real build.
 *
 * What is worth proving here rather than in a unit test is everything that only
 * exists once the screens, the routes and the session cookie are all present at
 * the same time: that signup records a programme without charging anybody, that
 * the dashboard is reachable before verification, that a reset actually signs
 * the other device out, and that signing out kills the row rather than the
 * cookie.
 */
const DB = process.env["DATABASE_URL"] ?? "";

function sqlOne(statement: string): string {
  return execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" }).trim();
}

function freshEmail(): string {
  return `aicha.${Date.now()}.${Math.floor(Math.random() * 100000)}@example.com`;
}

const PASSWORD = "correct horse battery";

function logLength(): number {
  try { return readFileSync(SERVER_LOG, "utf8").length; } catch { return 0; }
}

/**
 * The code, read out of the server's own output.
 *
 * Since review decision 1 a code exists only as a keyed hash, so there is
 * deliberately nowhere in the database to read one from. `ConsoleSender` prints
 * what it would have delivered — which is also exactly what a developer does
 * locally — so no test-only code path and no weakening of anything is needed.
 */
async function codeSentTo(address: string, since: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  const wanted = new RegExp(`would send to ${address.replace(/[.+]/g, "\\$&")}: [^\\n]*?(\\d{6})`);
  while (Date.now() < deadline) {
    let log = "";
    try { log = readFileSync(SERVER_LOG, "utf8").slice(since); } catch { /* not written yet */ }
    const match = wanted.exec(log);
    if (match?.[1] !== undefined) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No code was sent to ${address} within 15s.`);
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

/** Signs up through the real screens and accepts the terms. */
async function signUp(
  page: Page,
  email: string,
  programme: "vendeur" | "entrepreneur" = "vendeur",
): Promise<string> {
  await page.goto("/fr/sign-up");
  await page.getByTestId(`programme-${programme}`).click();
  await page.getByTestId("signup-continue").click();

  await expect(page.getByTestId("signup-step-account")).toBeVisible();
  await page.locator('input[autocomplete="name"]').fill("Aïcha Test");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByTestId("signup-continue").click();

  await expect(page.getByTestId("signup-consent")).toBeVisible();
  await page.locator('input[type="checkbox"]').check();
  await page.getByTestId("signup-consent-accept").click();
  await page.waitForURL(/\/fr$/);

  return sqlOne(`select u.id from users u join "user" au on au.id = u.auth_user_id
                  where lower(au.email) = '${email}'`);
}

test.describe("signing up with an email address", () => {
  test("records the free programme and lands on the app", async ({ page }) => {
    const email = freshEmail();
    const userId = await signUp(page, email, "vendeur");

    expect(userId).not.toBe("");
    expect(sqlOne(`select status from users where id = '${userId}'::uuid`)).toBe("active");
    expect(sqlOne(`select programme from users where id = '${userId}'::uuid`)).toBe("vendeur");
    // The free programme has no subscription and needs none.
    expect(sqlOne(
      `select count(*) from programme_subscriptions where user_id = '${userId}'::uuid`,
    )).toBe("0");
  });

  test("choosing Entrepreneur charges nothing and activates nothing", async ({ page }) => {
    const email = freshEmail();

    // The sentence saying so is on screen BEFORE the choice is submitted, not
    // in a confirmation afterwards.
    await page.goto("/fr/sign-up");
    await page.getByTestId("programme-entrepreneur").click();
    await expect(page.getByTestId("programme-not-paid")).toContainText("Aucun paiement");

    const userId = await signUp(page, email, "entrepreneur");

    expect(sqlOne(`select programme from users where id = '${userId}'::uuid`)).toBe("entrepreneur");
    expect(sqlOne(
      `select status from programme_subscriptions where user_id = '${userId}'::uuid`,
    )).toBe("pending_payment");
    /*
     * The assertions that matter. Nothing is active, and no money moved: no
     * order, no payment, no ledger transaction. A subscription that "worked"
     * without a payment provider would be exactly the fiction this milestone
     * was told not to build.
     */
    expect(sqlOne(
      `select count(*) from programme_subscriptions
        where user_id = '${userId}'::uuid and status = 'active'`,
    )).toBe("0");
    expect(sqlOne(`select count(*) from orders where buyer_user_id = '${userId}'::uuid`)).toBe("0");
    expect(sqlOne(
      `select count(*) from ledger_accounts
        where owner_type = 'user' and owner_id = '${userId}'::uuid`,
    )).toBe("0");
  });

  test("the dashboard is reachable before the address is verified", async ({ page }) => {
    const email = freshEmail();
    const userId = await signUp(page, email);

    expect(sqlOne(
      `select "emailVerified" from "user" where lower(email) = '${email}'`,
    )).toBe("f");

    // A real actor, with its real permissions, unverified.
    expect((await api(page, "GET", "/api/v1/me")).status).toBe(200);
    await page.goto("/fr/wallet");
    await expect(page).toHaveURL(/\/fr\/wallet$/);

    // And the banner offers verification rather than demanding it.
    await expect(page.getByTestId("email-unverified-banner")).toBeVisible();
    expect(sqlOne(`select status from users where id = '${userId}'::uuid`)).toBe("active");
  });

  test("opening the verification screen sends nothing and claims nothing", async ({ page }) => {
    const email = freshEmail();
    const before = logLength();
    await signUp(page, email);

    /*
     * Every request the page makes on load, recorded. The screen must not send
     * a code just because somebody looked at it: an automatic send here spends
     * one of the five an hour every time the screen is re-read, and the
     * cooldown then refuses the resend they actually meant to make.
     */
    const calls: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/v1/auth/email/verify") calls.push(r.method());
    });

    await page.getByTestId("email-verify-link").click();
    await page.waitForURL(/verify-email$/);
    await expect(page.getByTestId("verify-email-form")).toBeVisible();
    await page.waitForTimeout(1500);

    expect(calls, "the page must not send on load").toEqual([]);

    // And it does not announce a send. It names the address and asks for the
    // code; the claim that one was sent belongs to the server's own state.
    const intro = await page.getByTestId("verify-intro").textContent();
    expect(intro).not.toContain("Nous avons envoyé");
    expect(intro).toContain(email);

    // Signup did issue one, so the screen reports a code as pending.
    await expect(page.getByTestId("verify-email-form")).toHaveAttribute("data-pending", "true");
    await expect(page.getByTestId("verify-no-pending")).toHaveCount(0);
    expect(await codeSentTo(email, before)).toMatch(/^\d{6}$/);
  });

  test("says so plainly when no code is pending", async ({ page }) => {
    const email = freshEmail();
    await signUp(page, email);

    /*
     * The state signup's send would leave behind if it had failed, reproduced
     * by consuming the challenge out from under the screen. Before this the
     * page still opened with "we sent you a code", which is the sentence that
     * sent somebody hunting through their inbox for an email that was never
     * going to be there.
     */
    sqlOne(`update otp_challenges set consumed_at = now()
             where identifier = '${email}' and purpose = 'email_verification'`);

    await page.goto("/fr/verify-email");
    await expect(page.getByTestId("verify-no-pending")).toBeVisible();
    await expect(page.getByTestId("verify-email-form")).toHaveAttribute("data-pending", "false");
    // The way out is the button, which is enabled and is the only thing that sends.
    await expect(page.getByTestId("verify-resend")).toBeEnabled();
  });

  test("a resend refused by the cooldown says how long, and lets you through after", async ({ page }) => {
    /*
     * The real journey, at the real limits.
     *
     * `globalSetup` raises only the per-IP ceiling, because every browser test
     * comes from 127.0.0.1. The cooldown and the hourly per-address cap here
     * are the reviewed production numbers, and the point of this test is that
     * somebody who does the obvious thing — press "resend" the moment the
     * screen appears — is told what to do rather than locked out of their hour.
     */
    test.setTimeout(180_000);
    const email = freshEmail();
    await signUp(page, email);
    await page.goto("/fr/verify-email");

    await page.getByTestId("verify-resend").click();

    // Refused, with a countdown rather than "réessayez plus tard".
    await expect(page.getByTestId("verify-cooldown")).toBeVisible();
    const message = await page.getByTestId("verify-cooldown").textContent();
    expect(message).toMatch(/Réessayez dans \d+ seconde/);
    await expect(page.getByTestId("verify-resend")).toBeDisabled();

    const waitSeconds = Number(/(\d+)/.exec(message ?? "")?.[1] ?? "60");
    expect(waitSeconds).toBeGreaterThan(0);
    expect(waitSeconds, "the wait is the cooldown, not the rest of the hour")
      .toBeLessThanOrEqual(60);

    /*
     * Four more presses would have been enough, before the reorder, to spend
     * the whole hour on refusals. They cannot be pressed at all now, which is
     * the fix working at the level a person meets it.
     */
    const hourlyBucket =
      `email:send:email_verification:addr:${email}`;
    expect(sqlOne(
      `select coalesce(sum(count), 0) from rate_limit_counters where bucket = '${hourlyBucket}'`,
    ), "one code issued, one credit spent").toBe("1");

    // Wait the cooldown out, and the button comes back on its own.
    await expect(page.getByTestId("verify-resend"))
      .toBeEnabled({ timeout: (waitSeconds + 10) * 1000 });
    await expect(page.getByTestId("verify-cooldown")).toHaveCount(0);

    const before = logLength();
    await page.getByTestId("verify-resend").click();
    await expect(page.getByTestId("verify-sent")).toBeVisible();

    // A second real code, and a second credit — the hour is spent on codes.
    expect(await codeSentTo(email, before)).toMatch(/^\d{6}$/);
    expect(sqlOne(
      `select coalesce(sum(count), 0) from rate_limit_counters where bucket = '${hourlyBucket}'`,
    )).toBe("2");
  });

  test("verifying changes the flag and nothing else", async ({ page }) => {
    const email = freshEmail();
    /*
     * Marked BEFORE signing up, because that is when the code is sent.
     *
     * Signup fires the verification itself — the point of it being a banner
     * rather than a step — so a mark taken afterwards starts reading the log
     * past the only line that carries the code, and the resend button would
     * meet the one-a-minute cooldown rather than issue a second one.
     */
    const before = logLength();
    const userId = await signUp(page, email);
    const rolesBefore = sqlOne(
      `select count(*) from role_assignments where user_id = '${userId}'::uuid`,
    );

    await page.getByTestId("email-verify-link").click();
    await page.waitForURL(/\/verify-email$/);
    await page.locator('input[inputmode="numeric"]').fill(await codeSentTo(email, before));
    await page.locator('button[type="submit"]').click();
    await expect(page.getByTestId("verify-done")).toBeVisible();

    expect(sqlOne(`select "emailVerified" from "user" where lower(email) = '${email}'`)).toBe("t");
    // The consent gate and the permissions are exactly as they were.
    expect(sqlOne(`select status from users where id = '${userId}'::uuid`)).toBe("active");
    expect(sqlOne(
      `select count(*) from role_assignments where user_id = '${userId}'::uuid`,
    )).toBe(rolesBefore);
  });
});

test.describe("forgotten password", () => {
  test("answers the same for an address with an account and one without", async ({ page }) => {
    const email = freshEmail();
    await signUp(page, email);
    await page.goto("/fr/password-reset");

    // Known address.
    await page.locator('input[type="email"]').fill(email);
    await page.getByTestId("reset-continue").click();
    await expect(page.getByTestId("reset-sent")).toBeVisible();
    const known = await page.getByTestId("reset-sent").textContent();

    // Unknown address, from a clean page.
    await page.goto("/fr/password-reset");
    await page.locator('input[type="email"]').fill(freshEmail());
    await page.getByTestId("reset-continue").click();
    await expect(page.getByTestId("reset-sent")).toBeVisible();

    /*
     * Same words, same step, same next screen. The difference between the two
     * is precisely what somebody enumerating a customer list is measuring, and
     * this is the assertion that it is not on the page.
     */
    expect(await page.getByTestId("reset-sent").textContent()).toBe(known);
    await expect(page.getByTestId("reset-step-reset")).toBeVisible();
  });

  test("resets the password and signs the other device out", async ({ browser, page }) => {
    const email = freshEmail();
    const userId = await signUp(page, email);

    // A second device, signed in on the same account.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/fr/sign-in");
    await otherPage.locator('input[type="email"]').fill(email);
    await otherPage.locator('input[type="password"]').fill(PASSWORD);
    await otherPage.locator('button[type="submit"]').click();
    await otherPage.waitForURL(/\/fr$/);
    expect((await api(otherPage, "GET", "/api/v1/me")).status).toBe(200);

    const authUserId = sqlOne(`select auth_user_id from users where id = '${userId}'::uuid`);
    expect(Number(sqlOne(`select count(*) from session where "userId" = '${authUserId}'`)))
      .toBeGreaterThanOrEqual(2);

    const before = logLength();
    await page.goto("/fr/password-reset");
    await page.locator('input[type="email"]').fill(email);
    await page.getByTestId("reset-continue").click();
    await page.locator('input[inputmode="numeric"]').fill(await codeSentTo(email, before));
    await page.locator('input[type="password"]').fill("a brand new password");
    await page.getByTestId("reset-continue").click();
    await expect(page.getByTestId("reset-done")).toBeVisible();

    /*
     * Every session, not just this browser's. A reset that leaves an intruder
     * signed in on another device has achieved nothing: the account's owner
     * changes their password, feels safe, and the intruder is still there.
     */
    expect(sqlOne(`select count(*) from session where "userId" = '${authUserId}'`)).toBe("0");
    expect((await api(otherPage, "GET", "/api/v1/me")).status).toBe(401);

    // The new password works, the old one does not.
    await page.goto("/fr/sign-in");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    /*
     * Wait for the refusal itself, not for the step to still be the step it
     * already was. `signin-step-email` is visible before the request has even
     * been sent, so asserting on it passes instantly and the next fill races
     * the response — which is how this read as "the new password does not
     * work" when what actually happened was two submits in flight at once.
     */
    await expect(page.getByTestId("signin-error"))
      .toHaveText("Adresse e-mail ou mot de passe incorrect.");

    await page.locator('input[type="password"]').fill("a brand new password");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/fr$/);

    await other.close();
  });
});

test.describe("signing out", () => {
  test("deletes the session row, so the cookie is worth nothing", async ({ page }) => {
    const email = freshEmail();
    const userId = await signUp(page, email);
    const authUserId = sqlOne(`select auth_user_id from users where id = '${userId}'::uuid`);
    expect(sqlOne(`select count(*) from session where "userId" = '${authUserId}'`)).toBe("1");

    await page.getByTestId("open-menu").click();
    await page.getByTestId("sign-out").click();
    await expect(page.getByTestId("open-menu")).toBeVisible();

    expect(sqlOne(`select count(*) from session where "userId" = '${authUserId}'`)).toBe("0");
    expect((await api(page, "GET", "/api/v1/me")).status).toBe(401);
    await page.goto("/fr/wallet");
    await page.waitForURL(/\/sign-in/);
  });
});

test.describe("moving between programmes", () => {
  test("upgrades in place, keeping the same account", async ({ page }) => {
    const email = freshEmail();
    const userId = await signUp(page, email, "vendeur");
    const authUserId = sqlOne(`select auth_user_id from users where id = '${userId}'::uuid`);

    await page.goto("/fr/programme");
    await page.getByTestId("programme-entrepreneur").click();
    await page.getByTestId("programme-save").click();
    await expect(page.getByTestId("programme-status")).toContainText("En attente de paiement");

    expect(sqlOne(`select programme from users where id = '${userId}'::uuid`)).toBe("entrepreneur");
    // Same identity, same credential. Nothing asked for a second account.
    expect(sqlOne(`select auth_user_id from users where id = '${userId}'::uuid`)).toBe(authUserId);
    expect(sqlOne(
      `select count(*) from programme_subscriptions
        where user_id = '${userId}'::uuid and status = 'active'`,
    )).toBe("0");
  });
});
