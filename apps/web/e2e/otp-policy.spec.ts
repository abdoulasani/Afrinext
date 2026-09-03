import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * The OTP limits are configuration in the RUNNING application, not only in the
 * domain package.
 *
 * This test exists because CI found the gap. `loadOtpPolicy()` was written,
 * tested and correct, and nothing called it: apps/web built the auth instance
 * without a policy, so the process used the compiled-in defaults and an
 * operator's UPDATE changed nothing at all. Review decision 7 was satisfied in
 * packages/core and not in production, and no test could tell — the domain
 * tests call `loadOtpPolicy` themselves, which is precisely the call the app
 * was missing.
 *
 * So this one is deliberately end to end: it changes a row in
 * `platform_settings`, then asks the real server, over HTTP, for real codes,
 * and requires the answer to follow the row. Nothing here is stubbed and
 * nothing here is a test-only code path.
 *
 * Two limits are moved at once, and each catches the defect on its own:
 *
 *   - `perPhonePerHour` is lowered to 2, so the third send must be refused
 *     (the compiled-in default is 5, which would have allowed it);
 *   - `cooldownMs` is lowered to 1ms, so the second send must be allowed (the
 *     compiled-in default is 60s, which would have refused it).
 *
 * An unwired build fails both directions, not just one.
 */

const DB = process.env["DATABASE_URL"] ?? "";

function psql(statement: string): string {
  return execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" }).trim();
}

function freshPhone(): string {
  return `+22790${String(Math.floor(100000 + Math.random() * 899999))}`;
}

/**
 * Asks the server for a code, from inside the page.
 *
 * Same reason as everywhere else in this suite: the browser's origin and cookie
 * jar are what the application actually faces.
 */
async function send(page: Page, phone: string): Promise<{ status: number; code: string }> {
  return page.evaluate(async (number) => {
    const response = await fetch("/api/auth/phone-otp/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ phoneNumber: number }),
    });
    const body: unknown = await response.json().catch(() => ({}));
    const code = (body as { code?: string }).code ?? "";
    return { status: response.status, code };
  }, phone);
}

/** Whatever the row holds now — restored verbatim, so no later spec inherits this. */
let saved = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  saved = psql(`select value::text from platform_settings where key = 'auth.otp_policy'`);
});

test.afterAll(() => {
  psql(
    `update platform_settings set value = '${saved.replace(/'/g, "''")}'::jsonb
      where key = 'auth.otp_policy'`,
  );
  // The counters this test spent belong to a limit that no longer applies.
  psql("delete from rate_limit_counters");
});

test.describe("the OTP limits are read from platform_settings by the running app", () => {
  test("a stored limit governs issuance, and a stored cooldown governs it too", async ({ page }) => {
    // The server is already running and its auth instance is already built and
    // cached. If the policy were resolved at construction, this UPDATE would
    // arrive too late to matter — which is the whole point.
    psql(
      `update platform_settings
          set value = value || '{"perPhonePerHour":2,"cooldownMs":1}'::jsonb
        where key = 'auth.otp_policy'`,
    );

    await page.goto("/fr/sign-in");
    const phone = freshPhone();

    // Two sends inside a minute. The compiled-in cooldown is 60s, so an unwired
    // build refuses the second one.
    expect((await send(page, phone)).status, "first send").toBe(200);
    expect((await send(page, phone)).status, "second send, inside the default cooldown").toBe(200);

    // The third exceeds the STORED per-phone limit of 2. The compiled-in limit
    // is 5, so an unwired build allows it.
    const third = await send(page, phone);
    expect(third.status, "third send, over the stored limit").toBe(429);
    expect(third.code).toBe("ratelimit.exceeded");
  });

  test("raising the limit again takes effect without restarting the server", async ({ page }) => {
    psql(
      `update platform_settings
          set value = value || '{"perPhonePerHour":9,"cooldownMs":1}'::jsonb
        where key = 'auth.otp_policy'`,
    );

    await page.goto("/fr/sign-in");
    const phone = freshPhone();

    // Three sends, where the previous test proved two was the ceiling. Same
    // process, same build: an operator raised a limit and the application
    // followed. That is what "configuration, not business logic" has to mean.
    for (const attempt of [1, 2, 3]) {
      expect((await send(page, phone)).status, `send ${attempt} under the raised limit`).toBe(200);
    }
  });
});
