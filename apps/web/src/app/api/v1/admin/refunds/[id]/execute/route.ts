import { NextResponse } from "next/server";
import { refunds } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { getPaymentProvider } from "@/lib/payments";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Executes a refund. The only place money leaves on a person's authority.
 *
 * The body is empty by design, and that is the security argument. The amount,
 * the currency and the charge to reverse are all read from the database inside
 * the domain function; there is no destination parameter anywhere in the
 * provider interface. So this route has nothing a caller could set that would
 * change where money goes or how much of it goes there.
 *
 * `refund.execute` plus step-up elevation are checked in the domain, not here —
 * a check in a route handler protects one route, and a check in the domain
 * protects every caller, including the queue processor and any future one.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const result = await refunds.executeRefund(getDb(), actor, getPaymentProvider(), id);
    return NextResponse.json({
      data: {
        refundId: result.refundId,
        status: result.status,
        attemptNo: result.attemptNo,
        // The stage is returned because it is the reason for the status, and
        // an operator looking at `in_doubt` needs to know it was a timeout
        // rather than a rejection.
        stage: result.stage,
        providerRefundRef: result.providerRefundRef,
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
