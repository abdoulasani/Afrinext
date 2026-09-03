import { NextResponse } from "next/server";
import { refunds } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Manual reconciliation: two steps, two people, one route.
 *
 * `{"action":"propose", ...}` states what a provider statement says and moves
 * nothing. `{"action":"confirm"}` is a different person agreeing, and is what
 * moves the refund. Keeping them on one route rather than two is deliberate —
 * they are one operation with a gate in the middle, and splitting them into
 * separate endpoints invites a future caller to believe either half is
 * sufficient on its own.
 *
 * Everything that decides the outcome is in the domain: the permission, the
 * elevation, the requirement for an external reference, and the count of
 * distinct people who could confirm. This handler parses JSON.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      outcome?: unknown;
      providerRefundRef?: unknown;
      evidence?: unknown;
    };

    const db = getDb();

    if (body.action === "confirm") {
      const state = await refunds.confirmManualReconciliation(db, actor, id);
      return NextResponse.json({ data: state });
    }

    if (body.action !== "propose") {
      return NextResponse.json(
        { error: { code: "refund.bad_action", message: 'Use "propose" or "confirm".' } },
        { status: 400 },
      );
    }

    // Only the two outcomes a person could have read off a statement. An
    // unrecognised value is refused rather than coerced.
    if (body.outcome !== "succeeded" && body.outcome !== "failed") {
      return NextResponse.json(
        {
          error: {
            code: "refund.bad_outcome",
            message: 'A reconciliation states "succeeded" or "failed".',
          },
        },
        { status: 400 },
      );
    }

    const state = await refunds.proposeManualReconciliation(db, actor, {
      refundId: id,
      outcome: body.outcome,
      evidence: typeof body.evidence === "string" ? body.evidence : "",
      ...(typeof body.providerRefundRef === "string"
        ? { providerRefundRef: body.providerRefundRef }
        : {}),
    });
    return NextResponse.json({ data: state });
  } catch (error: unknown) {
    return apiError(error);
  }
}
