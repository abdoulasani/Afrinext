import { NextResponse } from "next/server";
import { programme as programmes } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { AUTH_REQUIRED, sessionIdentity } from "@/lib/email-auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const identity = await sessionIdentity();
    if (identity === undefined) return NextResponse.json(AUTH_REQUIRED, { status: 401 });

    const state = await programmes.programmeState(getDb(), identity.userId);
    return NextResponse.json({
      data: {
        programme: state.chosen,
        subscriptionStatus: state.subscription?.status ?? null,
        // Named `entitled`, never `active`, and never derived from the choice.
        entitled: state.entitled,
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

/**
 * Records the programme somebody chose. Charges nothing and activates nothing.
 *
 * Reachable after signup as well as during it, because moving from Vendeur to
 * Entrepreneur must never require a second account: it is an UPDATE on the row
 * the person already has, so their roles, store, wallet and ledger history
 * follow them across.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const identity = await sessionIdentity();
    if (identity === undefined) return NextResponse.json(AUTH_REQUIRED, { status: 401 });

    const body = (await request.json().catch(() => null)) as { programme?: unknown } | null;
    if (!programmes.isProgramme(body?.programme)) {
      return NextResponse.json(
        { error: { code: "programme.unknown", message: "Programme inconnu." } },
        { status: 400 },
      );
    }

    const result = await programmes.chooseProgramme(getDb(), {
      userId: identity.userId,
      programme: body.programme,
      actorUserId: identity.userId,
    });

    return NextResponse.json({
      data: {
        programme: result.programme,
        subscriptionStatus: result.subscription?.status ?? null,
        /*
         * Said out loud in the payload, because the screen that reads it must
         * not congratulate anybody on a subscription nobody has paid for. No
         * payment provider is implemented; this can only ever be false today.
         */
        entitled: false,
        priceMinor: result.subscription?.price.amountMinor.toString() ?? null,
        currency: result.subscription?.price.currency ?? null,
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
