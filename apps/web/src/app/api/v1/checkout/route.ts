import { NextResponse } from "next/server";
import { orders } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { requireActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Checkout.
 *
 * Note what the body may contain: a store slug, a product slug, a quantity and
 * an idempotency key. There is deliberately no price, currency, total, seller
 * or commission field — not "validated and ignored", but absent, so there is
 * nothing for a future edit to start trusting. Everything monetary is read from
 * the catalogue inside `createCheckout`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const body = (await request.json()) as {
      storeSlug?: unknown;
      productSlug?: unknown;
      quantity?: unknown;
      idempotencyKey?: unknown;
    };

    const key =
      typeof body.idempotencyKey === "string" && body.idempotencyKey !== ""
        ? body.idempotencyKey
        : request.headers.get("idempotency-key");

    if (typeof body.storeSlug !== "string" || typeof body.productSlug !== "string") {
      return NextResponse.json(
        { error: { code: "request.invalid", message: "A store and a product are required." } },
        { status: 400 },
      );
    }
    if (key === null || key === "") {
      return NextResponse.json(
        {
          error: {
            code: "request.invalid",
            message: "An idempotency key is required so a repeated submission cannot buy twice.",
          },
        },
        { status: 400 },
      );
    }

    const result = await orders.createCheckout(getDb(), actor, {
      storeSlug: body.storeSlug,
      productSlug: body.productSlug,
      checkoutKey: key,
      ...(typeof body.quantity === "number" ? { quantity: body.quantity } : {}),
    });

    return NextResponse.json(
      {
        data: {
          id: result.order.id,
          status: result.order.status,
          totalMinor: result.order.total.amountMinor.toString(),
          currency: result.order.total.currency,
          expiresAt: result.order.expiresAt.toISOString(),
          items: result.order.items.map((i) => ({
            productId: i.productId,
            title: i.title,
            quantity: i.quantity,
            unitPriceMinor: i.unitPrice.amountMinor.toString(),
          })),
        },
      },
      // 200 for a replay, 201 for a new order: a client that retries can tell
      // whether it created something without having to compare ids.
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error: unknown) {
    return apiError(error);
  }
}
