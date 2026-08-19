import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sessions are opaque server-side tokens, not JWTs: a session that can move
 * money has to be revocable in one statement, which a stateless token cannot
 * offer. Only the SHA-256 of the token is stored, so a database leak does not
 * hand an attacker live sessions.
 */
export const SESSION_TOKEN_BYTES = 32;
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
/** How recently a session must have been re-verified to perform a payout action. */
export const ELEVATION_WINDOW_MS = 10 * 60 * 1000;

export interface IssuedSession {
  /** Given to the client once, in an httpOnly cookie. Never stored. */
  readonly token: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSessionToken(ttlMs: number = DEFAULT_SESSION_TTL_MS, now = Date.now()): IssuedSession {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now + ttlMs),
  };
}

export function sessionTokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashSessionToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export interface SessionState {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly elevatedAt: Date | null;
}

export function isSessionActive(session: SessionState, now = new Date()): boolean {
  if (session.revokedAt !== null) return false;
  return session.expiresAt.getTime() > now.getTime();
}

/** Sensitive actions require a re-verification within the elevation window. */
export function isElevated(session: SessionState, now = new Date()): boolean {
  if (!isSessionActive(session, now)) return false;
  if (session.elevatedAt === null) return false;
  return now.getTime() - session.elevatedAt.getTime() <= ELEVATION_WINDOW_MS;
}
