import { NextResponse } from "next/server";
import { refunds } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The refund queue.
 *
 * `refund.read` and nothing more — support holds it so they can answer "where
 * is my refund?" without being able to move money. The domain does the
 * authorization; this handler does not decide anything, it only asks.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 100);

    const queue = await refunds.listRefundQueue(getDb(), actor, { limit });

    return NextResponse.json({
      data: queue.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        status: r.status,
        // Minor units as a string. A refund amount is a bigint and JSON has no
        // bigint, so it never becomes a Number anywhere on the way out.
        amountMinor: r.amount.amountMinor.toString(),
        currency: r.amount.currency,
        reason: r.reason,
        attemptCount: r.attemptCount,
        openAttempts: r.openAttempts,
        providerRefundRef: r.providerRefundRef,
        resolvedBy: r.resolvedBy,
        requestedByUserId: r.requestedByUserId,
        reconciliationMode: r.reconciliationMode,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: { count: queue.length },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
