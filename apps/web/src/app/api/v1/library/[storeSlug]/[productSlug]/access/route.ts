import { NextResponse } from "next/server";
import { content } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { getContentKey } from "@/lib/content";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived grant for one asset of a purchased product.
 *
 * The body names an asset id and a disposition. It does NOT name a user, an
 * entitlement or an order: the actor comes from the session, and whether that
 * actor may read that asset is a query, not a claim. An asset id belonging to
 * somebody else's purchase resolves to nothing and is refused with the same
 * message as one that does not exist.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeSlug: string; productSlug: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { storeSlug, productSlug } = await params;
    const body = (await request.json()) as { assetId?: unknown; disposition?: unknown };

    if (typeof body.assetId !== "string") {
      return NextResponse.json(
        { error: { code: "request.invalid", message: "An asset is required." } },
        { status: 400 },
      );
    }

    const db = getDb();
    /*
     * The product is resolved through the buyer's entitlement first, and the
     * asset is then required to belong to it.
     *
     * Two checks rather than one because the URL carries slugs the caller
     * chose: without this, a valid asset id from product A could be requested
     * under product B's URL and the grant would still be issued for A. It would
     * not leak anything — the asset check is the one that decides — but the two
     * would disagree, and code whose parts disagree is code nobody can reason
     * about.
     */
    const product = await content.findEntitledProduct(db, actor, storeSlug, productSlug);
    if (product === undefined || !product.assets.some((a) => a.id === body.assetId)) {
      throw new content.ContentForbiddenError();
    }

    const grant = await content.grantContentAccess(
      db,
      getContentKey(),
      actor,
      body.assetId,
      body.disposition === "inline" ? "inline" : "attachment",
    );

    return NextResponse.json({
      data: {
        // A path, not a bare token, so a caller never has to build the URL.
        url: `/api/v1/content/${encodeURIComponent(grant.token)}`,
        disposition: grant.disposition,
        expiresAt: grant.expiresAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
