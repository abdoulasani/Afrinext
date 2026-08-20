"use server";

import { revalidatePath } from "next/cache";
import { catalog, consent } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { DEFAULT_LOCALE } from "@afrinext/i18n";
import { headers } from "next/headers";
import { requireActor } from "@/lib/session";
import { actorLegalContext, clientContext } from "@/lib/consent";
import type { ActionState } from "@/lib/catalog-actions";

/**
 * Accepting the seller terms from the seller screen.
 *
 * Calls exactly the same `consent.acceptCurrentVersions` the API route calls,
 * with the same server-resolved context. The form contributes the fact that a
 * person clicked; it contributes nothing to the decision.
 */
export async function acceptSellerTermsAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = String(form.get("locale") ?? DEFAULT_LOCALE);
  try {
    const actor = await requireActor();
    const db = getDb();
    const context = await actorLegalContext(db, actor);
    await consent.acceptCurrentVersions(
      db, actor.userId, catalog.SELLER_CONSENT_KINDS, context,
      { method: "seller_onboarding", ...clientContext(await headers()) },
    );
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error) return { error: error.message };
    throw error;
  }
  revalidatePath(`/${locale}/sell`);
  return {};
}
