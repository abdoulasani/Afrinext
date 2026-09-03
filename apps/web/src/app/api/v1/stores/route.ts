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
    const body = (await request.json()) as {
      name?: unknown; slug?: unknown; tagline?: unknown; storeType?: unknown;
      description?: unknown; city?: unknown; countryCode?: unknown;
      contactPhone?: unknown; brand?: unknown;
    };
    /*
     * Every field goes to the domain RAW.
     *
     * Nothing about the request body is judged here, and that ordering is the
     * point: `createStore` runs `authorize()` and the seller-consent gate
     * before it looks at a single value, so a caller who may not open a store
     * is told exactly that — not that their store type is unsupported, which
     * would answer a question they were never entitled to ask.
     *
     * The type and the brand are still validated; they are validated by
     * `parseStoreType` and `parseStoreBrand` inside the domain, which is the
     * only place that can be sure the gates have already run.
     */
    const store = await catalog.createStore(getDb(), actor, {
      name: typeof body.name === "string" ? body.name : "",
      storeType: typeof body.storeType === "string" ? body.storeType : "",
      ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
      ...(typeof body.tagline === "string" ? { tagline: body.tagline } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(typeof body.city === "string" ? { city: body.city } : {}),
      ...(typeof body.countryCode === "string" ? { countryCode: body.countryCode } : {}),
      ...(typeof body.contactPhone === "string" ? { contactPhone: body.contactPhone } : {}),
      ...(body.brand !== undefined ? { brand: String(body.brand) } : {}),
    });
    return NextResponse.json(
      {
        data: {
          id: store.id, slug: store.slug, name: store.name,
          status: store.status, storeType: store.storeType,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    return apiError(error);
  }
}
