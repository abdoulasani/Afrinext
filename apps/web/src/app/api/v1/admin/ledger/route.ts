import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { authz, ledger } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Financial admin ledger viewer — the read foundation.
 *
 * Requires `ledger.read`, which support and finance hold and an ordinary member
 * does not. It reads the DERIVED balances, not the cache, and reports the
 * reconciliation state alongside: an operator looking at these numbers should be
 * told immediately if the cache and the entries disagree, rather than trusting a
 * figure that is drifting.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    await authz.authorize(db, actor, "ledger.read");

    const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 50), 200);

    const accounts = await db.execute<{
      account_id: string; kind: string; owner_type: string | null;
      owner_id: string | null; currency: string; balance_minor: bigint | string;
      entry_count: bigint | string;
    }>(sql`
      select account_id, kind, owner_type, owner_id, currency, balance_minor, entry_count
        from ledger_account_balances_derived
       order by kind, currency
       limit ${limit}
    `);

    const report = await ledger.reconcile(db);
    const toStr = (v: bigint | string): string => v.toString();

    return NextResponse.json({
      data: {
        accounts: accounts.rows.map((r) => ({
          accountId: r.account_id,
          kind: r.kind,
          ownerType: r.owner_type,
          ownerId: r.owner_id,
          currency: r.currency,
          balanceMinor: toStr(r.balance_minor),
          entryCount: toStr(r.entry_count),
        })),
      },
      meta: {
        reconciliation: {
          clean: ledger.reconciliationIsClean(report),
          checkedAccounts: report.checkedAccounts,
          driftingAccounts: report.drift.length,
          unbalancedTransactions: report.unbalancedTransactions.length,
          netByCurrency: Object.fromEntries(
            [...report.systemNetByCurrency].map(([c, n]) => [c, n.toString()]),
          ),
        },
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
