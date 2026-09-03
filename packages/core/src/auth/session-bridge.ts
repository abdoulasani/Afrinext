import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import type { Actor } from "../authz";
import { ElevationRequiredError } from "./errors";

/**
 * The seam between authentication and authorization.
 *
 * Better Auth answers "who is this?" and hands back its own user id. Everything
 * downstream — permissions, ledger ownership, consent, audit — is keyed on
 * Afrinext's `users.id`. This module is the only place the two are joined, and
 * it deliberately returns nothing but an identity: no roles, no permissions, no
 * capability of any kind. A caller that wants to know whether the actor may do
 * something must still ask `authorize()`.
 */
export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly authUserId: string;
  readonly elevatedAt: Date | null;
}

/** Afrinext's elevation window for payout-sensitive actions. */
export const ELEVATION_WINDOW_MS = 10 * 60 * 1000;

/**
 * Maps a Better Auth session onto an Afrinext actor.
 *
 * Returns undefined when there is no matching domain user — a credential
 * without a domain identity can do nothing at all, which is the safe direction
 * to fail in.
 */
export async function resolveActor(
  db: Database,
  session: AuthenticatedSession,
): Promise<Actor | undefined> {
  const rows = await db.execute<{ id: string; status: string }>(sql`
    select id, status from users where auth_user_id = ${session.authUserId} limit 1
  `);
  const user = rows.rows[0];
  if (user === undefined) return undefined;
  // A suspended account keeps its credentials but loses its actor.
  if (user.status !== "active") return undefined;

  return {
    userId: user.id,
    sessionId: session.sessionId,
    elevated:
      session.elevatedAt !== null &&
      Date.now() - session.elevatedAt.getTime() <= ELEVATION_WINDOW_MS,
  };
}

/** Loads a session by its Better Auth id, for revocation and elevation. */
export async function loadSession(
  db: Database,
  sessionId: string,
): Promise<AuthenticatedSession | undefined> {
  const rows = await db.execute<{ id: string; userId: string; elevatedAt: Date | null; expiresAt: Date }>(sql`
    select id, "userId", "elevatedAt", "expiresAt" from session where id = ${sessionId} limit 1
  `);
  const row = rows.rows[0];
  if (row === undefined) return undefined;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return undefined;
  return {
    sessionId: row.id,
    authUserId: row.userId,
    elevatedAt: row.elevatedAt === null ? null : new Date(row.elevatedAt),
  };
}

/**
 * Marks a session as freshly re-verified.
 *
 * Called only after a step-up challenge has actually been answered. The window
 * is short on purpose: a payout should require proof of possession now, not
 * proof that someone signed in three weeks ago.
 */
export async function markElevated(db: Database, sessionId: string, actorUserId: string): Promise<void> {
  await db.execute(sql`update session set "elevatedAt" = now() where id = ${sessionId}`);
  await audit(db, {
    actorUserId,
    actorKind: "user",
    action: "auth.session.elevated",
    targetType: "session",
    targetId: sessionId,
  });
}

/**
 * Guards an action that needs a fresh re-verification.
 *
 * Holding the permission is not enough for money: `withdrawal.approve` says the
 * actor is allowed in principle, elevation says they are present right now.
 */
export function requireElevation(actor: Actor, action: string): void {
  if (actor.elevated !== true) throw new ElevationRequiredError(action);
}

/** Revocation is one statement, which is why sessions are rows and not tokens. */
export async function revokeSession(
  db: Database,
  sessionId: string,
  actorUserId: string | undefined,
): Promise<boolean> {
  const result = await db.execute(sql`delete from session where id = ${sessionId}`);
  const revoked = (result.rowCount ?? 0) > 0;
  if (revoked) {
    await audit(db, {
      ...(actorUserId !== undefined ? { actorUserId } : {}),
      actorKind: actorUserId === undefined ? "system" : "user",
      action: "auth.session.revoked",
      targetType: "session",
      targetId: sessionId,
    });
  }
  return revoked;
}

/** Signs a person out everywhere — the thing you need when a phone is stolen. */
export async function revokeAllSessionsForUser(
  db: Database,
  domainUserId: string,
  actorUserId: string | undefined,
): Promise<number> {
  const result = await db.execute(sql`
    delete from session
     where "userId" in (select auth_user_id from users where id = ${domainUserId}::uuid)
  `);
  const count = result.rowCount ?? 0;
  await audit(db, {
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    actorKind: actorUserId === undefined ? "system" : "user",
    action: "auth.session.revoked_all",
    targetType: "user",
    targetId: domainUserId,
    context: { revoked: count },
  });
  return count;
}
