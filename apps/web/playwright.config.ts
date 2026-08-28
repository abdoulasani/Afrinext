import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * The workspace `.env`, read here rather than assumed to be exported.
 *
 * Next.js reads `.env` from `apps/web`; this monorepo keeps one at the root, so
 * a plain `pnpm test:e2e` used to start four servers that had no DATABASE_URL
 * and time out on a health check — a five-minute failure that looks like a
 * broken test and is a missing variable. CI, which exports everything
 * explicitly, never saw it. Anything already in the environment WINS, so that
 * stays true.
 */
function loadWorkspaceEnv(): void {
  // Playwright transpiles this config to CommonJS, so `import.meta.url` is not
  // available here. Both candidates are tried because the command is run from
  // the workspace root and from `apps/web` about equally often.
  let text: string | undefined;
  for (const candidate of ["../../.env", ".env"]) {
    try { text = readFileSync(resolve(process.cwd(), candidate), "utf8"); break; } catch { /* next */ }
  }
  if (text === undefined) return; // CI supplies these directly.
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null || line.trimStart().startsWith("#")) continue;
    const [, key, rawValue] = match as unknown as [string, string, string];
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
  }
}

loadWorkspaceEnv();

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
export const PORT = Number(process.env["E2E_PORT"] ?? 3100);
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

/**
 * The second application instance, and the bucket both instances share.
 *
 * The object-storage milestone makes a claim about TWO machines, so the suite
 * runs two: `next start` on {@link PORT} and a second on {@link PORT_B}, both
 * configured with `CONTENT_STORAGE=s3` against the fixture bucket on
 * {@link S3_FIXTURE_PORT}. A seller uploads through one and a buyer downloads
 * through the other. With a shared directory that test proves only that a
 * filesystem is shared; over the adapter it proves the milestone.
 */
export const PORT_B = Number(process.env["E2E_PORT_B"] ?? PORT + 6);
export const BASE_URL_B = `http://127.0.0.1:${PORT_B}`;
export const S3_FIXTURE_PORT = Number(process.env["S3_FIXTURE_PORT"] ?? PORT + 5);
/** Instance A of the object-storage pair. Named here so the spec cannot guess. */
export const PORT_A = PORT + 7;
export const BASE_URL_A = `http://127.0.0.1:${PORT_A}`;

/** What both instances are told about the bucket. Not a credential: a fixture. */
const S3_ENV =
  `CONTENT_STORAGE=s3 ` +
  `CONTENT_S3_ENDPOINT=http://127.0.0.1:${S3_FIXTURE_PORT} ` +
  `CONTENT_S3_REGION=us-east-1 CONTENT_S3_BUCKET=afrinext-e2e ` +
  `CONTENT_S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE ` +
  `CONTENT_S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY ` +
  `CONTENT_S3_FORCE_PATH_STYLE=yes `;

const SHARED_ENV =
  `NODE_ENV=production ALLOW_CONSOLE_SENDER=yes ` +
  `PAYMENT_PROVIDER=mock ALLOW_MOCK_PAYMENTS=yes ` +
  `MOCK_WEBHOOK_SECRET=${MOCK_WEBHOOK_SECRET} `;

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

  webServer: [
    {
      /*
       * NODE_ENV is set explicitly, and that is not a formality.
       *
       * `next start` only defaults NODE_ENV to production when it is not
       * already set — and `.env` sets it to development for the dev server. So
       * a local run served the app in development mode while CI served it in
       * production mode, and the two differ in ways that decide whether tests
       * pass: Better Auth enables its rate limiter only in production, and the
       * session cookie is only marked Secure in production.
       *
       * `ALLOW_LOCAL_CONTENT_STORAGE` is required for the same family of
       * reasons the payment and sender flags are: filesystem storage refuses to
       * run under a production build unless a deployment states that being a
       * single server was deliberate. This suite IS a single server, and says so.
       */
      command:
        `mkdir -p .e2e && rm -f ${SERVER_LOG} && ` + SHARED_ENV +
        `ALLOW_LOCAL_CONTENT_STORAGE=yes CONTENT_STORAGE_DIR=.e2e/content ` +
        `pnpm exec next start -p ${PORT} > ${SERVER_LOG} 2>&1`,
      url: BASE_URL,
      // Never silently reuse a server someone left running: it could be a
      // different build, which would make a green run meaningless.
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // The shared bucket. Verifies every signature; see the file's own note.
      command: `S3_FIXTURE_PORT=${S3_FIXTURE_PORT} node e2e/s3-fixture-server.mjs`,
      url: `http://127.0.0.1:${S3_FIXTURE_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Instance A of the object-storage pair. No disk is configured for it at
      // all, so anything it serves came out of the bucket.
      command: `mkdir -p .e2e && rm -f .e2e/server-s3-a.log && ` + SHARED_ENV + S3_ENV +
        `pnpm exec next start -p ${PORT_A} > .e2e/server-s3-a.log 2>&1`,
      url: BASE_URL_A,
      reuseExistingServer: false,
      // Longer than the single-instance timeout above on purpose: three
      // `next start` processes come up at once here, and on a two-core CI
      // runner the third one waits its turn for the CPU. A start-up timeout
      // reads exactly like a broken test and is not one.
      timeout: 180_000,
    },
    {
      // Instance B. A different process, on a different port, sharing only the
      // database and the bucket.
      command: `mkdir -p .e2e && rm -f .e2e/server-s3-b.log && ` + SHARED_ENV + S3_ENV +
        `pnpm exec next start -p ${PORT_B} > .e2e/server-s3-b.log 2>&1`,
      url: BASE_URL_B,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
