import { NextResponse } from "next/server";
import { authz } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Who the caller is, and what they may do.
 *
 * The permission list is for rendering an interface — deciding which buttons to
 * show. It is never the basis for allowing an action: every protected route
 * re-checks server-side, because a client can send whatever it likes.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    return NextResponse.json({
      data: {
        userId: actor.userId,
        elevated: actor.elevated === true,
        permissions: await authz.permissionsFor(db, actor),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
