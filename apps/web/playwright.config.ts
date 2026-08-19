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

export default defineConfig({
  testDir: "./e2e",
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
    command:
      `mkdir -p .e2e && rm -f ${SERVER_LOG} && ` +
      `ALLOW_CONSOLE_SENDER=yes pnpm exec next start -p ${PORT} > ${SERVER_LOG} 2>&1`,
    url: BASE_URL,
    // Never silently reuse a server someone left running: it could be a
    // different build, which would make a green run meaningless.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
