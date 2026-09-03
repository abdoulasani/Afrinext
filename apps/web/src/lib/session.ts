import { headers } from "next/headers";
import { authz, auth as core } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { getAuth } from "./auth";

/**
 * Resolves the current request's Afrinext actor, or undefined when signed out.
 *
 * Deliberately returns identity only. Knowing who someone is never implies what
 * they may do: callers must still go through `authorize()`.
 */
export async function currentActor(): Promise<authz.Actor | undefined> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session === null) return undefined;

  return core.resolveActor(getDb(), {
    sessionId: session.session.id,
    authUserId: session.session.userId,
    elevatedAt:
      (session.session as { elevatedAt?: Date | string | null }).elevatedAt != null
        ? new Date((session.session as { elevatedAt: Date | string }).elevatedAt)
        : null,
  });
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required.");
  }
}

export async function requireActor(): Promise<authz.Actor> {
  const actor = await currentActor();
  if (actor === undefined) throw new UnauthenticatedError();
  return actor;
}
