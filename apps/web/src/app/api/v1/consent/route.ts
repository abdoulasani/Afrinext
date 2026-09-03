import { NextResponse } from "next/server";
import { catalog, consent } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";
import { actorLegalContext, clientContext } from "@/lib/consent";

export const dynamic = "force-dynamic";

/**
 * What the signed-in person still has to accept, and accepting it.
 *
 * Both verbs call the same `packages/core/consent` functions the Server Action
 * calls. The route never decides whether consent is satisfied — it asks, and
 * reports. The gate itself lives inside `createStore`, so this endpoint being
 * wrong could at worst mislead a screen; it could not let anyone through.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    const context = await actorLegalContext(db, actor);
    const outstanding = await consent.outstandingConsents(
      db, actor.userId, catalog.SELLER_CONSENT_KINDS, context,
    );
    return NextResponse.json({
      data: {
        outstanding: outstanding.map((o) => ({
          kind: o.kind, version: o.version, locale: o.locale, contentHash: o.contentHash,
        })),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

/**
 * Accepts the current version of the seller terms.
 *
 * The body names no version id, and could not be trusted with one: a client
 * that chose the version would be able to record an acceptance of something
 * superseded — real-looking, and satisfying nothing. The version in force is
 * resolved server-side from the actor's own locale.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    const context = await actorLegalContext(db, actor);

    const accepted = await consent.acceptCurrentVersions(
      db, actor.userId, catalog.SELLER_CONSENT_KINDS, context,
      { method: "seller_onboarding", ...clientContext(request.headers) },
    );

    return NextResponse.json({
      data: {
        accepted: accepted.map((a) => ({
          kind: a.kind, version: a.version, newlyRecorded: a.newlyRecorded,
        })),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
