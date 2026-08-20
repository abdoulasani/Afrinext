"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { catalog, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { DEFAULT_LOCALE } from "@afrinext/i18n";
import { requireActor } from "@/lib/session";
import { currencyRegistry } from "@/lib/catalog";

/**
 * Server Actions for the seller screens.
 *
 * Each one resolves the actor server-side and calls the same
 * `packages/core/catalog` function the API routes call. No authorization
 * decision, price arithmetic or visibility rule is made here — a form post and
 * an API call must not be able to disagree about what is allowed.
 */

export type ActionState = { error?: string };

function fail(error: unknown): ActionState {
  // Domain errors carry a message written for the person reading the screen.
  // Anything else is not explained to them; it goes to the server log.
  if (error instanceof Error && "code" in error) return { error: error.message };
  throw error;
}

export async function createStoreAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  let slug: string;
  try {
    const actor = await requireActor();
    const store = await catalog.createStore(getDb(), actor, {
      name: String(form.get("name") ?? "").trim(),
      ...(String(form.get("tagline") ?? "").trim() !== ""
        ? { tagline: String(form.get("tagline")).trim() }
        : {}),
    });
    slug = store.slug;
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/sell`);
  // typedRoutes cannot expand a computed dynamic segment, so the cast is
  // explicit rather than the whole check being switched off.
  redirect(`/${locale}/sell/${slug}` as Route);
}

export async function publishStoreAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  const storeSlug = String(form.get("storeSlug") ?? "");
  try {
    const actor = await requireActor();
    const db = getDb();
    const store = await catalog.findStoreBySlug(db, storeSlug);
    await catalog.publishStore(db, actor, store.id);
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/sell/${storeSlug}`);
  return {};
}

export async function createProductAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  const storeSlug = String(form.get("storeSlug") ?? "");
  try {
    const actor = await requireActor();
    const db = getDb();
    const store = await catalog.findStoreBySlug(db, storeSlug);
    const registry = await currencyRegistry();

    // The typed amount is parsed against the currency's own exponent, so "1500"
    // in XOF is 1500 francs and the same string in a two-decimal currency would
    // be 1500 cents. Rejecting too many decimals is `parseMoney`'s job, not a
    // regex here.
    const price = m.parseMoney(
      String(form.get("price") ?? "").trim(),
      String(form.get("currency") ?? "XOF"),
      registry,
    );

    await catalog.createProduct(db, actor, {
      storeId: store.id,
      title: String(form.get("title") ?? "").trim(),
      price,
      ...(String(form.get("summary") ?? "").trim() !== ""
        ? { summary: String(form.get("summary")).trim() }
        : {}),
    });
  } catch (error: unknown) {
    if (error instanceof TypeError) return { error: error.message };
    return fail(error);
  }
  revalidatePath(`/${locale}/sell/${storeSlug}`);
  return {};
}

export async function publishProductAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  const storeSlug = String(form.get("storeSlug") ?? "");
  try {
    const actor = await requireActor();
    await catalog.publishProduct(getDb(), actor, String(form.get("productId") ?? ""));
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/sell/${storeSlug}`);
  return {};
}
