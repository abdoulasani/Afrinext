import { NextResponse } from "next/server";
import { orders, payments } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { getPaymentProvider } from "@/lib/payments";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Starts a charge for an order.
 *
 * The body carries ONE field, and only one: the channel the buyer chose. The
 * amount still comes from the order row, the buyer from the session, and the
 * order is looked up scoped to that buyer — so there remains no parameter
 * through which a caller could influence what is charged or whose order is
 * paid.
 *
 * The channel is not an exception to that rule. What a caller may send is
 * Afrinext's vocabulary, which `parsePaymentChannel` checks against the launch
 * allowlist; iPayMoney's own header values are refused like any other
 * unsupported string, and the translation to a provider header happens inside
 * the adapter where no request can reach it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const channel = payments.parsePaymentChannel(
      (body as { channel?: unknown })?.channel,
    );
    const payment = await orders.initiatePayment(getDb(), actor, getPaymentProvider(), {
      orderId: id,
      channel,
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
