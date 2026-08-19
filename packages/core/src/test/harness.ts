import { sql } from "drizzle-orm";
import { getDb, type Database } from "@afrinext/db";
import { uuidv7 } from "../ids";

/** Tables truncated between tests, in an order that respects foreign keys. */
const MUTABLE_TABLES = [
  "ledger_entries",
  "account_balances",
  "ledger_transactions",
  "ledger_accounts",
  "idempotency_keys",
  "consent_records",
  "audit_logs",
  "role_assignments",
  "sessions",
  "otp_challenges",
  "user_identities",
  "users",
  "rate_limit_counters",
];

export function testDb(): Database {
  return getDb();
}

/**
 * Truncates transactional data between tests.
 *
 * Append-only triggers block DELETE on ledger_entries and friends, so TRUNCATE
 * is used — it bypasses row triggers by design. Reference data (currencies,
 * countries, roles, permissions) is left in place: it is seeded once and read
 * by almost every test.
 */
export async function resetData(db: Database): Promise<void> {
  await db.execute(sql.raw(`truncate table ${MUTABLE_TABLES.join(", ")} restart identity cascade`));
  // Tests that publish a new legal document version must not leak it into the
  // next run: restore the seeded placeholder baseline.
  await db.execute(
    sql`delete from legal_document_versions where version <> '0.0.0-placeholder'`,
  );
}

export async function createTestUser(
  db: Database,
  options: { countryCode?: string; locale?: string } = {},
): Promise<string> {
  const id = uuidv7();
  await db.execute(sql`
    insert into users (id, display_name, country_code, locale)
    values (${id}, ${"Test " + id.slice(0, 8)}, ${options.countryCode ?? "NE"}, ${options.locale ?? "fr"})
  `);
  return id;
}

/** Ensures the reference data the suite depends on is present. */
export async function ensureReferenceData(db: Database): Promise<void> {
  const rows = await db.execute<{ count: string | bigint }>(
    sql`select count(*)::bigint as count from currencies`,
  );
  const count = Number(rows.rows[0]?.count ?? 0);
  if (count === 0) {
    throw new Error(
      "Reference data is missing from the test database. Run: pnpm --filter @afrinext/core seed",
    );
  }
}
