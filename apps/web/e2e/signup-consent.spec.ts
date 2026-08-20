import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SERVER_LOG } from "../playwright.config";

/**
 * Signup consent, from the position of someone trying to skip it.
 *
 * The account is created by the OTP flow and is deliberately unusable until the
 * general terms are accepted. What these tests establish is that the unusable
 * part lives on the server: the same session, driven past the UI or straight at
 * the API, still resolves to no actor.
 */
const DB = process.env["DATABASE_URL"] ?? "";

function sqlOne(statement: string): string {
  return execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" }).trim();
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

/**
 * Status only, no body.
 *
 * A removed route answers with Next's HTML 404 page, so parsing JSON there
 * throws before the status can be asserted.
 */
async function statusOf(page: Page, method: "GET" | "POST", path: string): Promise<number> {
  return page.evaluate(
    async ([verb, target]) => {
      const response = await fetch(target as string, {
        method: verb as string,
        credentials: "same-origin",
      });
      return response.status;
    },
    [method, path] as [string, string],
  );
}

/** Verifies the OTP and STOPS — leaving the account pending. */
async function verifyOnly(page: Page, phone: string): Promise<void> {
  await page.goto("/fr/sign-in");
  const before = logLength();
  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();
  await page.locator('input[inputmode="numeric"]').fill(await codeSentTo(phone, before));
  await page.locator('button[type="submit"]').click();
  await expect(page.getByTestId("signup-consent")).toBeVisible();
}

function userIdFor(phone: string): string {
  return sqlOne(`select u.id from users u join "user" au on au.id = u.auth_user_id
                  where au."phoneNumber" = '${phone}'`);
}

test.describe("signup cannot complete without the general terms", () => {
  test("the OTP succeeds, the account exists, and it grants nothing", async ({ page }) => {
    const phone = freshPhone();
    await verifyOnly(page, phone);

    // The account is real and the session is real.
    const userId = userIdFor(phone);
    expect(userId).not.toBe("");
    expect(sqlOne(`select status from users where id = '${userId}'::uuid`)).toBe("pending_consent");

    // And it resolves to no actor, so every protected route refuses it. This
    // is the same door suspension has always used.
    for (const route of ["/api/v1/me", "/api/v1/wallet"]) {
      const response = await api(page, "GET", route);
      expect(response.status, `${route} for a pending account`).toBe(401);
    }
    // Nothing has been accepted.
    expect(sqlOne(`select count(*) from consent_records where user_id = '${userId}'::uuid`)).toBe("0");
  });

  test("the wallet is unreachable by navigation too, not only by API", async ({ page }) => {
    const phone = freshPhone();
    await verifyOnly(page, phone);

    // Redirected back to sign-in: there is no actor to render a wallet for.
    await page.goto("/fr/wallet");
    await page.waitForURL(/\/sign-in/);
  });

  test("removing the consent step from the DOM does not bypass it", async ({ page }) => {
    const phone = freshPhone();
    await verifyOnly(page, phone);
    const userId = userIdFor(phone);

    // Delete the whole step, as anyone with dev tools could.
    await page.evaluate(() => {
      document.querySelector('[data-testid="signup-consent"]')?.remove();
    });
    await expect(page.getByTestId("signup-consent")).toHaveCount(0);

    // The account is exactly as unusable as it was.
    expect(sqlOne(`select status from users where id = '${userId}'::uuid`)).toBe("pending_consent");
    expect((await api(page, "GET", "/api/v1/me")).status).toBe(401);
    await page.goto("/fr/wallet");
    await page.waitForURL(/\/sign-in/);
  });

  test("accepting records BOTH documents at their exact versions and activates", async ({ page }) => {
    const phone = freshPhone();
    await verifyOnly(page, phone);
    const userId = userIdFor(phone);

    // The step names what is being agreed to, and which version.
    const panel = page.getByTestId("signup-consent");
    await expect(panel).toContainText("Conditions d'utilisation");
    await expect(panel).toContainText("Politique de confidentialité");
    await expect(panel).toContainText("0.0.0-placeholder");

    // The button is disabled until the person actually says yes.
    await expect(page.getByTestId("signup-consent-accept")).toBeDisabled();
    await page.locator('input[name="agree"]').check();
    await page.getByTestId("signup-consent-accept").click();

    await page.waitForURL(/\/wallet$/);
    expect(sqlOne(`select status from users where id = '${userId}'::uuid`)).toBe("active");

    // Exactly two records, both at the current version, both marked signup.
    const recorded = sqlOne(`
      select string_agg(d.kind || '@' || v.version || '/' || c.method, ',' order by d.kind)
        from consent_records c
        join legal_document_versions v on v.id = c.document_version_id
        join legal_documents d on d.id = v.document_id
       where c.user_id = '${userId}'::uuid`);
    expect(recorded).toBe(
      "privacy_policy@0.0.0-placeholder/signup,terms_of_use@0.0.0-placeholder/signup",
    );

    // And the account works now.
    expect((await api(page, "GET", "/api/v1/me")).status).toBe(200);
  });

  test("the API path and the UI path cannot disagree", async ({ page }) => {
    const phone = freshPhone();
    await verifyOnly(page, phone);
    const userId = userIdFor(phone);

    // Accept through the API instead of the form. Same core function.
    const accepted = await api(page, "POST", "/api/v1/consent/account");
    expect(accepted.status).toBe(200);
    expect((accepted.body as { data: { activated: boolean } }).data.activated).toBe(true);

    expect(sqlOne(`select status from users where id = '${userId}'::uuid`)).toBe("active");
    expect((await api(page, "GET", "/api/v1/me")).status).toBe(200);
    expect(sqlOne(`select count(*) from consent_records where user_id = '${userId}'::uuid`)).toBe("2");
  });

  test("the OTP guarantees still hold through the changed flow", async ({ page }) => {
    const phone = freshPhone();
    await verifyOnly(page, phone);

    // Only a keyed hash, and nothing in Better Auth's table — unchanged by
    // anything this milestone did.
    const hash = sqlOne(`select code_hash from otp_challenges where identifier = '${phone}'`);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sqlOne(`select count(*) from verification where identifier = '${phone}'`)).toBe("0");
    // Single use.
    expect(sqlOne(
      `select consumed_at is not null from otp_challenges where identifier = '${phone}'`,
    )).toBe("t");

    // And the removed plaintext endpoint is still removed.
    expect(await statusOf(page, "POST", "/api/auth/phone-number/send-otp")).toBe(404);
  });
});
