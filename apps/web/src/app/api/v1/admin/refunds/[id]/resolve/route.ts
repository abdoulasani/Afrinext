import { NextResponse } from "next/server";
import { authz, refunds } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { getPaymentProvider } from "@/lib/payments";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Asks the provider what became of a refund we never got an answer for.
 *
 * Gated on `refund.execute` rather than `refund.read`, because although this
 * changes nothing at the provider it can move a refund to `failed` — and a
 * `failed` refund is retryable. Whoever can make a refund retryable is
 * exercising the execute capability one step removed.
 *
 * It may legitimately resolve nothing. A provider with no status query, a
 * provider that cannot be reached, a `pending` answer and a failure with no
 * evidence all leave the refund exactly where it was, and the response says
 * which of those happened.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    await authz.authorize(db, actor, "refund.execute");

    const { id } = await params;
    const result = await refunds.resolveRefundFromProvider(db, getPaymentProvider(), id);
    return NextResponse.json({
      data: { refundId: result.refundId, status: result.status, resolved: result.resolved, reason: result.reason },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
