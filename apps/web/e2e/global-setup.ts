import { execFileSync } from "node:child_process";

/**
 * Prepares the database for a browser run.
 *
 * Sixteen browser tests now sign up a fresh phone number, and every one of them
 * comes from 127.0.0.1. The reviewed per-IP limit is 20 codes an hour, so the
 * suite exhausts it partway through and the rest fail on a 429 that has nothing
 * to do with what they are testing.
 *
 * This is the carrier-NAT problem the Phase 1 packet named as the production
 * tuning point to watch, arriving early and in our own test suite: many
 * distinct users behind one address.
 *
 * The response is the one the architecture already provides. Review decision 7
 * required these limits to be configuration rather than literals, so a test
 * environment raises the per-IP ceiling in `platform_settings` — the same
 * UPDATE an operator would run. Nothing else moves:
 *
 *   - the PER-PHONE limit, the cooldown and the attempt bounds are untouched,
 *     and every test still uses a fresh number, so those are still exercised;
 *   - the per-IP limiter itself is still tested, in `ratelimit.test.ts` and in
 *     `flow.test.ts`, which asserts the 429 and its Retry-After;
 *   - no application code knows this happened.
 */
export default function globalSetup(): void {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required to prepare the browser test database.");
  }

  const psql = (statement: string): void => {
    execFileSync("psql", [url, "-Atc", statement], { encoding: "utf8" });
  };

  psql(`
    update platform_settings
       set value = value || '{"perIpPerHour": 10000}'::jsonb
     where key = 'auth.otp_policy'
  `);

  // A previous run's counters would otherwise still be inside the same hourly
  // window. This is test-database hygiene, not a limit change.
  psql("delete from rate_limit_counters");

  /*
   * Restore the legal baseline.
   *
   * One browser test publishes a new document version to prove the gate
   * re-closes. In CI that is harmless because the database is built from zero,
   * but locally the database persists — so the next run finds that version in
   * force and every assertion about "0.0.0-placeholder" fails for a reason that
   * has nothing to do with the code.
   *
   * Consent records reference those versions and are append-only — a trigger
   * refuses DELETE outright, which is the guarantee working. TRUNCATE is the
   * one way past it, exactly as the domain test harness does, and it is
   * confined to a test database. Wiping acceptances changes nobody's access:
   * `users.status` is what gates an account, and it is untouched.
   */
  psql("truncate table consent_records");

  /*
   * Clear the checkout tables between local runs.
   *
   * In CI the database is built from zero, so this changes nothing there. It
   * matters locally, where a persistent database accumulates orders and
   * payments from previous runs and a `count(*)` assertion would be counting
   * history rather than what the test just did.
   */
  psql("truncate table payment_events, payments, entitlements, order_items, orders cascade");
  psql("delete from legal_document_versions where version <> '0.0.0-placeholder'");
}
