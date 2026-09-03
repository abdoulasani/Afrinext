import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";

export interface BalanceDrift {
  readonly accountId: string;
  readonly kind: string;
  readonly currency: string;
  readonly cachedMinor: bigint;
  readonly derivedMinor: bigint;
  readonly differenceMinor: bigint;
}

export interface ReconciliationReport {
  readonly checkedAccounts: number;
  readonly drift: readonly BalanceDrift[];
  /** Net of every entry in the ledger, per currency. Must be zero. */
  readonly systemNetByCurrency: ReadonlyMap<string, bigint>;
  readonly unbalancedTransactions: readonly { id: string; currency: string; net: bigint }[];
}

const toBigInt = (v: bigint | string | number): bigint =>
  typeof v === "bigint" ? v : BigInt(v);

/**
 * Compares every cached balance against the sum of that account's entries, and
 * checks the two system-wide invariants.
 *
 * This is the job that would catch a bug in posting before a user does. It
 * reads only; a drift is reported and alarmed on, never silently "fixed" —
 * overwriting the cache would destroy the evidence of what went wrong.
 */
export async function reconcile(db: Database): Promise<ReconciliationReport> {
  const driftRows = await db.execute<{
    account_id: string;
    kind: string;
    currency: string;
    cached: bigint | string;
    derived: bigint | string;
  }>(sql`
    select d.account_id, d.kind, d.currency,
           coalesce(b.balance_minor, 0)::bigint as cached,
           d.balance_minor::bigint              as derived
      from ledger_account_balances_derived d
      left join account_balances b on b.account_id = d.account_id
     where coalesce(b.balance_minor, 0) <> d.balance_minor
  `);

  const totalRows = await db.execute<{ count: bigint | string }>(
    sql`select count(*)::bigint as count from ledger_accounts`,
  );

  // The whole ledger must net to zero per currency: value only ever moves.
  const netRows = await db.execute<{ currency: string; net: bigint | string }>(sql`
    select currency, sum(direction::bigint * amount_minor)::bigint as net
      from ledger_entries group by currency
  `);

  const unbalancedRows = await db.execute<{
    transaction_id: string;
    currency: string;
    net: bigint | string;
  }>(sql`
    select transaction_id, currency, sum(direction::bigint * amount_minor)::bigint as net
      from ledger_entries
     group by transaction_id, currency
    having sum(direction::bigint * amount_minor) <> 0
  `);

  return {
    checkedAccounts: Number(toBigInt(totalRows.rows[0]?.count ?? 0n)),
    drift: driftRows.rows.map((r) => ({
      accountId: r.account_id,
      kind: r.kind,
      currency: r.currency,
      cachedMinor: toBigInt(r.cached),
      derivedMinor: toBigInt(r.derived),
      differenceMinor: toBigInt(r.derived) - toBigInt(r.cached),
    })),
    systemNetByCurrency: new Map(netRows.rows.map((r) => [r.currency, toBigInt(r.net)])),
    unbalancedTransactions: unbalancedRows.rows.map((r) => ({
      id: r.transaction_id,
      currency: r.currency,
      net: toBigInt(r.net),
    })),
  };
}

export function reconciliationIsClean(report: ReconciliationReport): boolean {
  if (report.drift.length > 0) return false;
  if (report.unbalancedTransactions.length > 0) return false;
  for (const net of report.systemNetByCurrency.values()) if (net !== 0n) return false;
  return true;
}
