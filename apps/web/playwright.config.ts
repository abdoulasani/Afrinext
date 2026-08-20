import { defineConfig } from "@playwright/test";

/**
 * Browser tests for the three authorization assertions.
 *
 * Deliberately not a UI suite. Phase 1 shipped with every HTTP and UI claim
 * resting on someone having run curl by hand, and the most security-relevant
 * behaviour in the application — a signed-in member being refused an admin
 * route — had no automated proof at all. These three tests exist to make that
 * proof executable in CI. Adding more of them is a decision, not a default.
 *
 * They run against a real production build served by `next start`, driven by a
 * real browser, over a real session cookie. Nothing is stubbed: replacing any
 * of it with a unit test would test the mock rather than the application.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 3100);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Where the server's own output is captured.
 *
 * The sign-in test needs the verification code, and since review decision 1 the
 * code is stored only as a keyed hash — there is deliberately nowhere to read it
 * from the database. So the test reads it the same way a developer does: from
 * what `ConsoleSender` prints. That requires no test-only code path and no
 * weakening of anything; `ConsoleSender` still refuses to run in production
 * without the explicit opt-in, which this command supplies and a deployment
 * would not.
 */
export const SERVER_LOG = ".e2e/server.log";

/**
 * The secret the mock provider signs its webhooks with.
 *
 * Shared with the checkout spec so a test can produce a genuinely signed event
 * — and, just as importantly, an unsigned or wrongly signed one. Not a
 * credential: the mock provider is refused in production unless someone also
 * sets ALLOW_MOCK_PAYMENTS.
 */
export const MOCK_WEBHOOK_SECRET = "e2e-mock-webhook-secret";

export default defineConfig({
  testDir: "./e2e",
  // Raises only the per-IP OTP ceiling for the test database, because every
  // browser test signs up from 127.0.0.1. See e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  reporter: process.env["CI"] !== undefined ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    // The phone this is built for, not a desktop window narrowed down.
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    /*
     * NODE_ENV is set explicitly, and that is not a formality.
     *
     * `next start` only defaults NODE_ENV to production when it is not already
     * set — and `.env` sets it to development for the dev server. So a local
     * run served the app in development mode while CI served it in production
     * mode, and the two differ in ways that decide whether tests pass: Better
     * Auth enables its rate limiter only in production, and the session cookie
     * is only marked Secure in production. A suite that green-lights a build CI
     * then rejects is worse than no suite, so this pins the mode CI uses.
     */
    command:
      `mkdir -p .e2e && rm -f ${SERVER_LOG} && ` +
      `NODE_ENV=production ALLOW_CONSOLE_SENDER=yes ` +
      // The mock payment provider needs a SECOND deliberate variable to run
      // under a production build, exactly as ConsoleSender does. Saying
      // PAYMENT_PROVIDER=mock is not enough, because that is the variable a
      // misconfigured deployment gets wrong.
      `PAYMENT_PROVIDER=mock ALLOW_MOCK_PAYMENTS=yes ` +
      `MOCK_WEBHOOK_SECRET=${MOCK_WEBHOOK_SECRET} ` +
      // Uploaded files go to a directory the run owns, so a suite never reads
      // bytes a previous run left behind.
      `CONTENT_STORAGE_DIR=.e2e/content ` +
      `pnpm exec next start -p ${PORT} > ${SERVER_LOG} 2>&1`,
    url: BASE_URL,
    // Never silently reuse a server someone left running: it could be a
    // different build, which would make a green run meaningless.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
