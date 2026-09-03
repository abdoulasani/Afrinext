import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { logger } from "../observability";
import {
  consumeAll, emailSendRules,
  type OtpPolicy, type RateLimitVerdict,
} from "../ratelimit";
import type { EmailSender } from "./messaging";
import { normaliseEmail } from "./phone";
import { hashPassword } from "./password";
import { issueChallenge, consumeChallenge } from "./otp-store";
import type { OtpTiming } from "./otp";

const log = logger.child({ component: "auth.email" });

/**
 * The domain that phone signup invents, and the whole reason for this module.
 *
 * ---------------------------------------------------------------------------
 * Why a synthetic address exists at all
 * ---------------------------------------------------------------------------
 *
 * Better Auth's `user.email` is NOT NULL UNIQUE, and Afrinext's launch market
 * is phone-first: most people will never have an email address on file. So the
 * phone plugin mints `<digits>@phone.afrinext.local` to satisfy the column.
 *
 * That address is a placeholder wearing the costume of a real one. It looks
 * valid to the schema, it is unique, and it will never receive mail — the TLD
 * does not resolve and never will. Every path that treats an address as a way
 * to reach a person has to know the difference, or it will cheerfully send a
 * password reset into a void and tell the person it worked.
 *
 * ---------------------------------------------------------------------------
 * One helper, three call sites
 * ---------------------------------------------------------------------------
 *
 *   - sign-in by email refuses one, with the same answer as a wrong password;
 *   - password reset never sends to one, and says exactly what it says for an
 *     address that does not exist;
 *   - the unverified banner offers "add an email" rather than "verify" one.
 *
 * Spelling the check inline in three places is how the fourth place forgets.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "phone.afrinext.local";

export function isSyntheticEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}

/** A real, reachable address: parses, and is not the placeholder. */
export function isReachableEmail(email: string | null | undefined): boolean {
  if (email === null || email === undefined) return false;
  const normalised = normaliseEmail(email);
  return normalised !== null && !isSyntheticEmail(normalised);
}

export interface EmailAuthDeps {
  /*
   * An `EmailSender`, not a `MessageSender`.
   *
   * Narrowed on purpose now that the interface splits by channel: this module
   * has never sent an SMS and asking for the ability to would be asking for
   * something it must not use. It also means the web layer can hand it the
   * email half alone, so a route that only sends email cannot be the thing
   * that breaks when the SMS channel changes.
   */
  readonly sender: EmailSender;
  readonly key: Buffer;
  readonly timing?: OtpTiming | undefined;
  readonly ipAddress?: string | undefined;
  /**
   * Issuance limits. Omitted means the built-in defaults; the web layer passes
   * `loadOtpPolicy(db)`'s result so a limit is an UPDATE rather than a deploy.
   */
  readonly policy?: OtpPolicy | undefined;
}

/**
 * What a caller is told, and it is deliberately almost nothing.
 *
 * `sent` is returned whether or not an account exists, whether or not the
 * address is reachable, and whether or not anything was actually delivered.
 * The endpoint's job is to be useless for enumeration; the audit log is where
 * the truth goes.
 */
export type IssueOutcome =
  | { readonly outcome: "sent" }
  | { readonly outcome: "rate_limited"; readonly retryAfterMs: number };

const limited = (v: RateLimitVerdict): IssueOutcome =>
  ({ outcome: "rate_limited", retryAfterMs: v.retryAfterMs });

/**
 * An address an operator can act on, that is not the address.
 *
 * A refusal has to be visible in the log or nobody can tell a rate limit from
 * an outage — that is what this whole change is for. But a log line is a copy
 * of the data, kept somewhere with different access rules and a different
 * retention, and "aicha@yahoo.com asked for a code at 07:04" is a fact about a
 * person that operations does not need.
 *
 * The domain is kept whole, because that IS operational: it says whether one
 * mail provider is being hammered. The local part keeps its first character
 * and its length, which is enough for a person holding the address to confirm
 * a line is theirs, and not enough to reconstruct one that is not.
 *
 * The phone path logs its identifier in full. That is not a precedent to copy;
 * it is the next thing to fix, and it is out of scope here.
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const head = local[0] ?? "";
  return `${head}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

/**
 * Records a refusal, in the log and in the audit trail.
 *
 * Modelled on `guardedSend` in the phone path, which has done both since Phase
 * 1. The email path shipped with neither, and the cost was exactly what you
 * would predict: an operator watching the Render log while somebody pressed
 * "resend" saw nothing at all, because every refusal in this module returned
 * without a word. A limiter nobody can observe is indistinguishable from a
 * broken sender.
 *
 * The code is not here, the address is masked, and the reason, the counters
 * and the wait are — the four things an operator actually needs.
 */
async function recordRefusal(
  db: Database,
  input: {
    readonly address: string | null;
    readonly purpose: string;
    readonly verdict: RateLimitVerdict;
    readonly userId?: string | undefined;
  },
): Promise<void> {
  const masked = input.address === null ? "***" : maskEmail(input.address);
  const context = {
    reason: "rate_limited",
    channel: "email",
    purpose: input.purpose,
    address: masked,
    used: input.verdict.used,
    limit: input.verdict.limit,
    retryAfterMs: input.verdict.retryAfterMs,
  };

  log.warn("email code not issued", context);
  await audit(db, {
    actorKind: input.userId === undefined ? "system" : "user",
    ...(input.userId !== undefined ? { actorUserId: input.userId } : {}),
    action: "auth.email.rate_limited",
    targetType: "user",
    ...(input.userId !== undefined ? { targetId: input.userId } : {}),
    context,
  });
}

async function issueAndSend(
  db: Database,
  deps: EmailAuthDeps,
  input: {
    readonly email: string;
    readonly purpose: "email_verification" | "password_reset";
    readonly subject: string;
    readonly body: (code: string) => string;
    readonly auditAction: string;
    readonly userId?: string | undefined;
  },
): Promise<IssueOutcome> {
  const address = normaliseEmail(input.email);

  /*
   * The limit is consumed BEFORE the address is judged, deliberately.
   *
   * Limiting only real, reachable addresses would make the limiter itself an
   * oracle: an attacker learns which addresses exist by seeing which ones
   * eventually answer 429 and which ones never do. Every request costs a
   * token, including the ones that will turn out to lead nowhere.
   *
   * The bucket keys on the raw input when it does not parse, so a flood of
   * garbage still counts against the IP rather than spreading across an
   * unbounded set of addresses that each get their own fresh budget.
   */
  const verdict = await consumeAll(
    db,
    emailSendRules(
      address ?? input.email.trim().toLowerCase().slice(0, 160),
      deps.ipAddress,
      input.purpose,
      deps.policy,
    ),
  );
  if (!verdict.allowed) {
    await recordRefusal(db, {
      address,
      purpose: input.purpose,
      verdict,
      userId: input.userId,
    });
    return limited(verdict);
  }

  // Unparseable, or the placeholder the phone path invents. Nothing is sent,
  // and the caller is told the same thing as everybody else.
  if (address === null || isSyntheticEmail(address)) {
    log.warn("email code not issued", {
      reason: address === null ? "unparseable" : "synthetic_address",
      channel: "email",
      purpose: input.purpose,
      address: address === null ? "***" : maskEmail(address),
    });
    return { outcome: "sent" };
  }

  const challenge = await issueChallenge(db, {
    kind: "email",
    identifier: address,
    purpose: input.purpose,
    key: deps.key,
    ...(deps.ipAddress !== undefined ? { ipAddress: deps.ipAddress } : {}),
    ...(deps.timing !== undefined ? { timing: deps.timing } : {}),
  });

  await deps.sender.sendEmail({
    to: address,
    subject: input.subject,
    body: input.body(challenge.code),
    /*
     * The challenge id, which is the natural identifier and already unique.
     *
     * `issueChallenge` retires any live code for this identifier and purpose
     * and inserts exactly one row, so one id means one code means one message.
     * If the provider call is retried after its response is lost, the retry
     * carries the same key and the person gets one email rather than two —
     * two working codes for one account is confusing, and the second arriving
     * minutes later reads as a code somebody else requested.
     */
    idempotencyKey: challenge.challengeId,
  });

  /*
   * The code is never logged, never audited and never returned — the rule the
   * phone path already follows. What is recorded is that a code went out.
   */
  await audit(db, {
    actorKind: input.userId === undefined ? "system" : "user",
    ...(input.userId !== undefined ? { actorUserId: input.userId } : {}),
    action: input.auditAction,
    targetType: "user",
    ...(input.userId !== undefined ? { targetId: input.userId } : {}),
    context: { channel: "email", sender: deps.sender.id },
  });

  return { outcome: "sent" };
}

/**
 * The Afrinext identity behind a Better Auth credential, for the audit row.
 *
 * `audit.targetId` points at `users.id` everywhere else in the codebase, not at
 * Better Auth's text id, and a log where the same person is two different
 * identifiers depending on which module wrote the row is a log nobody can
 * follow. Returns an empty object when there is no link, so the audit entry is
 * still written — losing the record because the join missed is worse than a
 * record without a target.
 */
async function domainUserId(
  db: Database,
  authUserId: string | undefined,
): Promise<{ targetId?: string }> {
  if (authUserId === undefined) return {};
  const rows = await db.execute<{ id: string }>(sql`
    select id from users where auth_user_id = ${authUserId} limit 1
  `);
  const id = rows.rows[0]?.id;
  return id === undefined ? {} : { targetId: id };
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

/**
 * Sends a verification code. Never blocks anything.
 *
 * Verification is a trust signal Afrinext records; it is NOT the consent gate
 * and it is NOT account activation. `resolveActor()` keeps refusing anybody
 * whose `users.status` is not `active`, exactly as before, and an unverified
 * address reduces no permission. Conflating the two would silently turn a
 * product decision — "let people in before they verify" — into a legal one.
 */
export async function requestEmailVerification(
  db: Database,
  deps: EmailAuthDeps,
  input: { readonly email: string; readonly userId?: string | undefined },
): Promise<IssueOutcome> {
  return issueAndSend(db, deps, {
    email: input.email,
    purpose: "email_verification",
    subject: "Afrinext — vérification de votre adresse",
    body: (code) => `Votre code de vérification Afrinext : ${code}`,
    auditAction: "auth.email.verification_sent",
    userId: input.userId,
  });
}

export type VerifyOutcome =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false };

/**
 * Confirms a code and marks the address verified.
 *
 * EVERY failure answers identically — wrong code, expired code, no challenge,
 * exhausted attempts, synthetic address. The endpoint cannot be used to learn
 * which addresses have codes in flight. The real reason goes to the log.
 */
export async function confirmEmailVerification(
  db: Database,
  deps: EmailAuthDeps,
  input: { readonly email: string; readonly code: string },
): Promise<VerifyOutcome> {
  const address = normaliseEmail(input.email);
  if (address === null || isSyntheticEmail(address)) return { ok: false };

  const result = await consumeChallenge(db, {
    kind: "email",
    identifier: address,
    purpose: "email_verification",
    code: input.code,
    key: deps.key,
  });

  if (!result.ok) {
    log.warn("email verification refused", { reason: result.reason });
    return { ok: false };
  }

  const marked = await db.execute<{ id: string }>(sql`
    update "user" set "emailVerified" = true, "updatedAt" = now()
     where lower(email) = ${address}
    returning id
  `);

  await audit(db, {
    actorKind: "system",
    action: "auth.email.verified",
    targetType: "user",
    ...(await domainUserId(db, marked.rows[0]?.id)),
    context: { channel: "email" },
  });

  return { ok: true, email: address };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordReset(
  db: Database,
  deps: EmailAuthDeps,
  input: { readonly email: string },
): Promise<IssueOutcome> {
  return issueAndSend(db, deps, {
    email: input.email,
    purpose: "password_reset",
    subject: "Afrinext — réinitialisation de votre mot de passe",
    body: (code) => `Votre code de réinitialisation Afrinext : ${code}`,
    auditAction: "auth.password.reset_sent",
  });
}

export type ResetOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "invalid" | "weak_password" };

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Sets a new password, then throws every other session away.
 *
 * The revocation is the point of the flow, not housekeeping after it. A reset
 * that leaves an attacker's session alive has achieved nothing: the person
 * whose account it is changes their password, feels safe, and the intruder is
 * still signed in on another device. Better Auth's `session` table is the only
 * session store, so deleting the rows IS signing those devices out.
 *
 * The current session is deleted too. The screen that calls this sends the
 * person to sign in with the password they just chose, which is the honest
 * ending: a reset means every existing session is suspect, including this one.
 */
export async function resetPassword(
  db: Database,
  deps: EmailAuthDeps,
  input: {
    readonly email: string;
    readonly code: string;
    readonly newPassword: string;
  },
): Promise<ResetOutcome> {
  const address = normaliseEmail(input.email);
  if (address === null || isSyntheticEmail(address)) return { ok: false, reason: "invalid" };
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "weak_password" };
  }

  const result = await consumeChallenge(db, {
    kind: "email",
    identifier: address,
    purpose: "password_reset",
    code: input.code,
    key: deps.key,
  });
  if (!result.ok) {
    log.warn("password reset refused", { reason: result.reason });
    return { ok: false, reason: "invalid" };
  }

  const found = await db.execute<{ id: string }>(sql`
    select id from "user" where lower(email) = ${address} limit 1
  `);
  const authUserId = found.rows[0]?.id;
  // A consumed code with no account behind it: the code was for an address
  // that has since been removed. Answer as a refusal, and say nothing more.
  if (authUserId === undefined) return { ok: false, reason: "invalid" };

  const hash = await hashPassword(input.newPassword);

  await db.transaction(async (tx) => {
    /*
     * Better Auth stores credentials in `account`, one row per provider. The
     * password lives on the row whose providerId is "credential"; updating any
     * other row would be a no-op that looks like success.
     */
    await tx.execute(sql`
      update account set password = ${hash}, "updatedAt" = now()
       where "userId" = ${authUserId} and "providerId" = 'credential'
    `);
    await tx.execute(sql`delete from session where "userId" = ${authUserId}`);
  });

  await audit(db, {
    actorKind: "system",
    action: "auth.password.reset",
    targetType: "user",
    ...(await domainUserId(db, authUserId)),
    context: { sessionsRevoked: true },
  });

  return { ok: true };
}
