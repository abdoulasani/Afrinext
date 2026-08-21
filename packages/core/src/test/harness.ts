import { sql } from "drizzle-orm";
import { getDb, type Database } from "@afrinext/db";
import { uuidv7 } from "../ids";
import { OTP_POLICY, OTP_POLICY_SETTING_KEY } from "../ratelimit";

/** Tables truncated between tests, in an order that respects foreign keys. */
const MUTABLE_TABLES = [
  // Checkout. Listed before the catalogue they reference, and before the
  // ledger: an order is evidence about a product and a buyer, so it cannot
  // outlive either.
  "digital_assets",
  // Refunds reference payments and orders, and refund_attempts references
  // refunds — listed before all of them so the order is explicit rather than
  // relying on a cascade to be right.
  "refund_attempts",
  "notification_outbox",
  "payment_events",
  "refunds",
  "payments",
  "entitlements",
  "order_items",
  "orders",
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
  // Restore the seeded legal baseline in both directions.
  //
  // Removing versions a test published is the obvious half. The other half is
  // re-creating placeholders a test DELETED — a gate that fails closed can only
  // be tested by taking its document away, and without this the rest of the
  // suite inherits a database where the document no longer exists and every
  // later consent check fails for the wrong reason. That happened; this is the
  // fix, in the harness rather than in the one test that noticed.
  await db.execute(
    sql`delete from legal_document_versions where version <> '0.0.0-placeholder'`,
  );
  await db.execute(sql`
    insert into legal_document_versions
      (id, document_id, version, locale, content_hash, effective_from)
    select gen_random_uuid(), d.id, '0.0.0-placeholder', l.locale,
           encode(sha256((d.kind || ':' || l.locale)::bytea), 'hex'),
           now() - interval '1 day'
      from legal_documents d
      cross join (values ('fr'), ('en')) as l(locale)
     where not exists (
       select 1 from legal_document_versions v
        where v.document_id = d.id and v.locale = l.locale
          and v.version = '0.0.0-placeholder'
     )
  `);
  // And undo any shift of the baseline's effective date.
  await db.execute(sql`
    update legal_document_versions
       set effective_from = now() - interval '1 day'
     where version = '0.0.0-placeholder' and effective_from > now()
  `);
  /*
   * Restore the OTP policy row.
   *
   * The limits are configuration, and the only honest way to test that is to
   * change them — so several tests do. Without this, the next test inherits a
   * ceiling of one send an hour and fails for a reason that has nothing to do
   * with what it was written to check. The seeded row is the reviewed default,
   * which is exactly what OTP_POLICY holds.
   */
  await db.execute(sql`
    update platform_settings set value = ${JSON.stringify(OTP_POLICY)}::jsonb
     where key = ${OTP_POLICY_SETTING_KEY}
  `);
  /*
   * Restore the reviewed refund policy, for the same reason.
   *
   * The clamps are only honestly testable by writing values that try to defeat
   * them, so several tests do exactly that. Without this restoration, the next
   * test inherits whatever the last one wrote and fails somewhere unrelated to
   * what it was written to check.
   */
  await db.execute(sql`
    update platform_settings set value = '3'::jsonb where key = 'refund.max_attempts';
  `);
  await db.execute(sql`
    update platform_settings set value = '300'::jsonb where key = 'refund.retry_backoff_seconds';
  `);
  await db.execute(sql`
    update platform_settings set value = '900'::jsonb where key = 'refund.stuck_in_flight_seconds';
  `);
  await db.execute(sql`
    update platform_settings set value = '20'::jsonb where key = 'refund.queue_batch_size';
  `);
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
