"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { catalog, content, money as m } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { DEFAULT_LOCALE } from "@afrinext/i18n";
import { requireActor } from "@/lib/session";
import { currencyRegistry } from "@/lib/catalog";
import { getContentStorage } from "@/lib/content";

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

/**
 * Attaches a file to a product.
 *
 * The store scope is resolved from the product row inside `attachAsset`, not
 * from this form — a store id in a hidden input would be a store id somebody
 * could change. The content type comes from the uploaded part and is checked
 * against an allow-list, because these bytes are served back from an Afrinext
 * origin.
 */
export async function attachAssetAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  const storeSlug = String(form.get("storeSlug") ?? "");
  try {
    const actor = await requireActor();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choisissez un fichier." };
    }
    if (file.size > content.MAX_ASSET_BYTES) {
      return { error: "Ce fichier est trop volumineux." };
    }
    const title = String(form.get("title") ?? "").trim();
    await content.attachAsset(getDb(), getContentStorage(), actor, {
      productId: String(form.get("productId") ?? ""),
      title: title === "" ? file.name : title,
      contentType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/sell/${storeSlug}`);
  return {};
}

export async function createStoreAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  let slug: string;
  try {
    const actor = await requireActor();
    /*
     * Every field is read from the form and validated by the domain. The
     * OWNER is not: it comes from the session, so there is no field in this
     * request through which somebody could open a store in another person's
     * name.
     */
    const text = (key: string): string => String(form.get(key) ?? "").trim();
    const store = await catalog.createStore(getDb(), actor, {
      name: text("name"),
      // Raw. `createStore` validates it, but only after the permission and
      // consent gates — see the note on `CreateStoreInput.storeType`.
      storeType: text("storeType"),
      ...(text("tagline") !== "" ? { tagline: text("tagline") } : {}),
      ...(text("description") !== "" ? { description: text("description") } : {}),
      ...(text("city") !== "" ? { city: text("city") } : {}),
      ...(text("countryCode") !== "" ? { countryCode: text("countryCode") } : {}),
      ...(text("contactPhone") !== "" ? { contactPhone: text("contactPhone") } : {}),
      ...(text("brand") !== "" ? { brand: text("brand") } : {}),
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

/**
 * Sets the licence text on the product's DRAFT version.
 *
 * The product id comes from the form, and that is safe for the same reason it
 * is everywhere else here: `setDraftLicence` resolves the owning store from the
 * product row and authorizes against it. A product id belonging to somebody
 * else is refused, and refused identically to one that does not exist.
 */
export async function setLicenceAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  const storeSlug = String(form.get("storeSlug") ?? "");
  try {
    const actor = await requireActor();
    const text = String(form.get("licence") ?? "").trim();
    await content.setDraftLicence(
      getDb(), actor, String(form.get("productId") ?? ""), text === "" ? null : text,
    );
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/sell/${storeSlug}`);
  return {};
}

/** Sets the per-file, per-buyer download limit. Empty means unlimited. */
export async function setDownloadLimitAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  const storeSlug = String(form.get("storeSlug") ?? "");
  try {
    const actor = await requireActor();
    const raw = String(form.get("limit") ?? "").trim();
    /*
     * Empty is "no limit", which is a real answer and not a missing one. Any
     * other non-integer is refused by the domain rather than coerced here — a
     * silently coerced "abc" would become a limit the seller never chose.
     */
    const limit = raw === "" ? null : Number.parseInt(raw, 10);
    await content.setDownloadLimit(
      getDb(), actor, String(form.get("productId") ?? ""),
      limit !== null && Number.isNaN(limit) ? Number.NaN : limit,
    );
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/sell/${storeSlug}`);
  return {};
}

/** Publishes the product's draft version, making it what new buyers receive. */
export async function publishVersionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  const storeSlug = String(form.get("storeSlug") ?? "");
  try {
    const actor = await requireActor();
    await content.publishVersion(getDb(), actor, String(form.get("productId") ?? ""));
  } catch (error: unknown) {
    return fail(error);
  }
  revalidatePath(`/${locale}/sell/${storeSlug}`);
  return {};
}
