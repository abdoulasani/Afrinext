import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { authz } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The caller's own wallet.
 *
 * Two things worth noticing. First, the query is scoped to the actor in SQL —
 * there is no "fetch then check", which is how IDOR gets in. Second, the
 * language: these are *entitlements*, a contractual claim on Afrinext, not a
 * deposit and not protected client funds. The wording is deliberate and is part
 * of the regulatory posture, not decoration.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    await authz.authorize(db, actor, "wallet.read_own");

    const rows = await db.execute<{
      kind: string; currency: string; balance_minor: bigint | string;
    }>(sql`
      select kind, currency, balance_minor
        from ledger_account_balances_derived
       where owner_type = 'user' and owner_id = ${actor.userId}::uuid
       order by currency, kind
    `);

    const toBig = (v: bigint | string): bigint => (typeof v === "bigint" ? v : BigInt(v));
    const balances = rows.rows.map((r) => ({
      kind: r.kind,
      currency: r.currency,
      // Money crosses the wire as minor units plus a currency, never as a
      // formatted string and never as a float. XOF has zero decimal places.
      amountMinor: toBig(r.balance_minor).toString(),
    }));

    return NextResponse.json({
      data: {
        entitlements: balances,
        note: "Balances are contractual entitlements against Afrinext, not deposits.",
      },
      meta: { derivedFrom: "ledger_entries" },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
