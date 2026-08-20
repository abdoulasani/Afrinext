import { NextResponse } from "next/server";
import { orders } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { getPaymentProvider } from "@/lib/payments";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Starts a charge for an order.
 *
 * The body is empty by design. The amount comes from the order row, the buyer
 * from the session, and the order itself is looked up scoped to that buyer — so
 * this route has no parameter through which a caller could influence what is
 * charged or whose order is paid.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const payment = await orders.initiatePayment(getDb(), actor, getPaymentProvider(), {
      orderId: id,
    });
    return NextResponse.json({
      data: {
        id: payment.id,
        orderId: payment.orderId,
        status: payment.status,
        provider: payment.provider,
        providerRef: payment.providerRef,
        amountMinor: payment.amount.amountMinor.toString(),
        currency: payment.amount.currency,
        ...(payment.redirectUrl !== undefined ? { redirectUrl: payment.redirectUrl } : {}),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
