import { sql } from "drizzle-orm";
import { getDb, type Database } from "@afrinext/db";
import { uuidv7 } from "../ids";

/** Tables truncated between tests, in an order that respects foreign keys. */
const MUTABLE_TABLES = [
  // Catalogue. Products cascade from stores, but both are listed so the
  // truncation is explicit rather than relying on a cascade to be right.
  "products",
  "stores",
  "ledger_entries",
  "account_balances",
  "ledger_transactions",
  "ledger_accounts",
  "idempotency_keys",
  // Frozen fee snapshots and settlement state. TRUNCATE, not DELETE: the
  // append-only triggers refuse row deletion by design.
  "fee_lines",
  "fee_schedules",
  "commission_rules",
  "settlement_holds",
  "consent_records",
  "audit_logs",
  "role_assignments",
  "otp_challenges",
  "rate_limit_counters",
  // Better Auth's tables. Truncated with the domain ones so a test never
  // inherits a session or credential from the test before it.
  "session",
  "account",
  "verification",
  "\"user\"",
  "users",
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

/**
 * Flattens an error and everything it wraps into one string.
 *
 * Drizzle 0.45 wraps driver errors in DrizzleQueryError, so a PostgreSQL
 * trigger message ("... is append-only") is no longer the top-level message.
 * Assertions need to see the whole chain or they silently stop checking what
 * they were written to check.
 */
export function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

/** Asserts a promise rejects with a message matching anywhere in the cause chain. */
export async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    const chain = messageChain(error);
    if (!pattern.test(chain)) {
      throw new Error(`Expected rejection matching ${pattern} but got: ${chain}`);
    }
    return;
  }
  throw new Error(`Expected a rejection matching ${pattern}, but the promise resolved.`);
}
