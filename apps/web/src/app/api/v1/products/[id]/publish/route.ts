import { NextResponse } from "next/server";
import { catalog } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { currencyRegistry, serialiseMoney } from "@/lib/catalog";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Publishing is the same core call the seller screen makes. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const product = await catalog.publishProduct(getDb(), actor, id);
    const registry = await currencyRegistry();
    return NextResponse.json({
      data: {
        id: product.id, slug: product.slug, status: product.status,
        publishedAt: product.publishedAt?.toISOString() ?? null,
        price: serialiseMoney(product.price, registry),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
