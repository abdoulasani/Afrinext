import { NextResponse } from "next/server";
import { catalog, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { currencyRegistry, serialiseMoney } from "@/lib/catalog";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A store's catalogue, for whoever administers it.
 *
 * Prices arrive as minor units — a string, so a large amount cannot be mangled
 * by JSON's number type on the way in — and go out the same way, with the
 * currency's exponent alongside. At no point is an amount a float.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    const { slug } = await params;
    const store = await catalog.findStoreBySlug(db, slug);
    const products = await catalog.listStoreProducts(db, actor, store.id);
    const registry = await currencyRegistry();
    return NextResponse.json({
      data: products.map((p) => ({
        id: p.id, slug: p.slug, title: p.title, summary: p.summary,
        status: p.status, price: serialiseMoney(p.price, registry),
      })),
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const db = getDb();
    const { slug } = await params;
    const store = await catalog.findStoreBySlug(db, slug);

    const body = (await request.json()) as {
      title?: unknown; slug?: unknown; summary?: unknown;
      priceMinor?: unknown; currency?: unknown;
    };
    if (typeof body.title !== "string" || typeof body.currency !== "string") {
      return NextResponse.json(
        { error: { code: "request.invalid", message: "A title and a currency are required." } },
        { status: 400 },
      );
    }
    // Minor units as a string or an integer, never a decimal: the caller states
    // the amount in the currency's own smallest unit and `money()` refuses
    // anything that is not a whole number of them.
    let price;
    try {
      price = m.money(BigInt(String(body.priceMinor)), body.currency);
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "request.invalid",
            message: "priceMinor must be a whole number of the currency's minor units.",
          },
        },
        { status: 400 },
      );
    }

    const product = await catalog.createProduct(db, actor, {
      storeId: store.id,
      title: body.title,
      price,
      ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
    });
    const registry = await currencyRegistry();
    return NextResponse.json(
      {
        data: {
          id: product.id, slug: product.slug, title: product.title,
          status: product.status, price: serialiseMoney(product.price, registry),
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    return apiError(error);
  }
}
