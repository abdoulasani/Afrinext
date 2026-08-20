import { NextResponse } from "next/server";
import { catalog } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The seller's own stores, and opening one.
 *
 * Both call the same `packages/core/catalog` functions the seller screens call.
 * If this route and the Server Action could disagree about who may open a store
 * or what a valid slug is, one of them would eventually be wrong.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const stores = await catalog.listOwnStores(getDb(), actor);
    return NextResponse.json({
      data: stores.map((s) => ({
        id: s.id, slug: s.slug, name: s.name, tagline: s.tagline, status: s.status,
      })),
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const body = (await request.json()) as { name?: unknown; slug?: unknown; tagline?: unknown };
    if (typeof body.name !== "string") {
      return NextResponse.json(
        { error: { code: "request.invalid", message: "A store name is required." } },
        { status: 400 },
      );
    }
    const store = await catalog.createStore(getDb(), actor, {
      name: body.name,
      ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
      ...(typeof body.tagline === "string" ? { tagline: body.tagline } : {}),
    });
    return NextResponse.json(
      { data: { id: store.id, slug: store.slug, name: store.name, status: store.status } },
      { status: 201 },
    );
  } catch (error: unknown) {
    return apiError(error);
  }
}
