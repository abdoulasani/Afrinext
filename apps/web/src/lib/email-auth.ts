import { sql } from "drizzle-orm";
import { auth as core, ratelimit } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { headers } from "next/headers";
import { getAuth } from "./auth";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
}

/**
 * The runtime pieces the email flows need, assembled per request.
 *
 * The policy is a value here rather than a resolver because it is read once,
 * on this request, right before the counters it governs are written — the
 * reason `createAuth` needs a function does not apply.
 */
export async function emailAuthDeps(): Promise<core.EmailAuthDeps> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    // No email provider has been chosen. ConsoleSender refuses to run under
    // NODE_ENV=production without an explicit opt-out, so a missing provider
    // fails loudly instead of silently dropping every verification code.
    sender: new core.ConsoleSender(),
    key: core.deriveOtpKey(requiredEnv("SESSION_SECRET")),
    policy: await ratelimit.loadOtpPolicy(getDb()),
    ...(ip !== undefined && ip !== "" ? { ipAddress: ip } : {}),
  };
}

export interface SessionIdentity {
  /** `users.id` — what roles, consent, audit and the ledger are keyed on. */
  readonly userId: string;
  readonly authUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * Identity from the session, without demanding an actor.
 *
 * Same reasoning as the consent endpoint: a `pending_consent` account resolves
 * to NO actor, and asking somebody to verify their email address is not a
 * capability — it acts on their own account and grants nothing. Requiring an
 * actor here would lock out exactly the people who have just signed up.
 */
export async function sessionIdentity(): Promise<SessionIdentity | undefined> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session === null) return undefined;

  const rows = await getDb().execute<{
    id: string; auth_user_id: string; email: string; email_verified: boolean;
  }>(sql`
    select u.id, u.auth_user_id, a.email, a."emailVerified" as email_verified
      from users u join "user" a on a.id = u.auth_user_id
     where u.auth_user_id = ${session.session.userId}
     limit 1
  `);
  const row = rows.rows[0];
  if (row === undefined) return undefined;
  return {
    userId: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    emailVerified: row.email_verified,
  };
}

/** 401 body, in the one shape every route uses. */
export const AUTH_REQUIRED = {
  error: { code: "auth.required", message: "Authentication required." },
} as const;

/**
 * The one answer every issuance endpoint gives.
 *
 * `sent` whether or not the account exists, whether or not the address is
 * reachable and whether or not anything was delivered. A 429 is the only other
 * outcome, and it is reached identically for a known and an unknown address.
 */
export function issueResponse(outcome: core.IssueOutcome): Response {
  if (outcome.outcome === "rate_limited") {
    return Response.json(
      {
        error: {
          code: "ratelimit.exceeded",
          message: "Trop de demandes. Réessayez plus tard.",
          retryAfterMs: outcome.retryAfterMs,
        },
      },
      {
        status: 429,
        // A 429 without Retry-After tells a client to guess, and clients guess
        // badly. The auth handler already answers this way; so does this.
        headers: { "Retry-After": String(Math.max(1, Math.ceil(outcome.retryAfterMs / 1000))) },
      },
    );
  }
  return Response.json({ data: { sent: true } });
}
