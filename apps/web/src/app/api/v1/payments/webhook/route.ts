import { NextResponse } from "next/server";
import { orders } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { getPaymentProvider } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * The provider's callback. The only place a payment is confirmed.
 *
 * Three properties of this handler are load-bearing:
 *
 *   1. It reads the RAW bytes and hands them to the provider unparsed. Parsing
 *      first and verifying the parsed shape is how signature checks get
 *      bypassed — the signature covers the bytes, not our interpretation.
 *   2. It requires no session. A provider has no cookie, so authentication here
 *      IS the signature; the browser's opinion about whether payment succeeded
 *      never reaches this code path at all.
 *   3. It answers the same 400 for every refusal and never says which check
 *      failed. Someone probing with forged amounts learns nothing from the
 *      response; the reason is written to `payment_events` and the audit log,
 *      where only we can read it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const raw = Buffer.from(await request.arrayBuffer());

  try {
    const result = await orders.applyProviderEvent(
      getDb(),
      getPaymentProvider(),
      raw,
      request.headers,
    );
    // 200 for applied and for ignored alike: a provider retrying a duplicate
    // must be told "received", or it will keep retrying forever.
    return NextResponse.json({ data: { outcome: result.outcome } });
  } catch {
    return NextResponse.json(
      { error: { code: "payment.webhook_rejected", message: "That event was not accepted." } },
      { status: 400 },
    );
  }
}
