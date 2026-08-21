"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { orders, profile } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { getPaymentProvider } from "@/lib/payments";
import { requireActor } from "@/lib/session";

/**
 * Server Actions for the buyer screens.
 *
 * Same rule as the seller actions: these resolve the actor and call the same
 * `packages/core/orders` functions the API routes call. A form post and an API
 * call must not be able to disagree about what a product costs or who may buy
 * it, and the only way to guarantee that is for both to reach the same
 * function.
 */

export type ActionState = { error?: string };

function fail(error: unknown): ActionState {
  if (error instanceof Error && "code" in error) return { error: error.message };
  throw error;
}

export async function startCheckoutAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? "fr");
  let orderId: string;
  try {
    const actor = await requireActor();
    const result = await orders.createCheckout(getDb(), actor, {
      storeSlug: String(form.get("storeSlug") ?? ""),
      productSlug: String(form.get("productSlug") ?? ""),
      /*
       * The key is minted when the page renders and travels in the form.
       *
       * So two taps on one rendered page carry the same key and resolve to one
       * order, while a fresh visit after an abandoned checkout carries a new
       * one and is free to start again. Deriving it from the product instead
       * would be idempotent forever — and would refuse a second purchase
       * attempt after the first expired.
       */
      checkoutKey: String(form.get("checkoutKey") ?? ""),
    });
    orderId = result.order.id;
  } catch (error: unknown) {
    return fail(error);
  }
  redirect(`/${locale}/orders/${orderId}` as Route);
}

export async function payOrderAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? "fr");
  const orderId = String(form.get("orderId") ?? "");
  try {
    const actor = await requireActor();
    await orders.initiatePayment(getDb(), actor, getPaymentProvider(), { orderId });
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/orders/${orderId}`);
  return {};
}

/**
 * The buyer's own name and country.
 *
 * Note what is NOT read from the form: any identifier. The subject is the
 * session's actor, so a posted `userId` is inert — there is no parameter for it
 * to reach. `completeBuyerProfile` takes an Actor and no user id at all.
 */
export async function completeProfileAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? "fr");
  try {
    const actor = await requireActor();
    await profile.completeBuyerProfile(getDb(), actor, {
      fullName: String(form.get("fullName") ?? ""),
      country: String(form.get("country") ?? ""),
    });
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}`);
  return {};
}
