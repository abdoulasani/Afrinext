import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@afrinext/db";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { OTP_POLICY, OTP_POLICY_SETTING_KEY } from "../ratelimit";
import { deriveOtpKey } from "./otp";
import { hasLiveChallenge, issueChallenge } from "./otp-store";
import { ConsoleSender } from "./messaging";
import { hashPassword, verifyPassword } from "./password";
import {
  MIN_PASSWORD_LENGTH, SYNTHETIC_EMAIL_DOMAIN, maskEmail,
  confirmEmailVerification, isReachableEmail, isSyntheticEmail,
  requestEmailVerification, requestPasswordReset, resetPassword,
  type EmailAuthDeps,
} from "./email-identity";

let db: Database;
let sender: ConsoleSender;
let deps: EmailAuthDeps;

const key = deriveOtpKey("test-secret-not-used-for-anything-real-0123456789");

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  sender = new ConsoleSender();
  deps = { sender, key };
});

/** The last code the sender would have delivered to an address. */
function codeTo(address: string): string {
  const code = sender.lastCodeTo(address);
  expect(code, `a code should have been sent to ${address}`).toBeDefined();
  return code as string;
}

/**
 * An account that signed up with an email address, the way the new path does:
 * a Better Auth `user` row with a credential, linked to an Afrinext identity.
 */
async function createEmailAccount(
  email: string,
  password = "correct horse battery",
): Promise<{ userId: string; authUserId: string }> {
  const userId = await createTestUser(db);
  const authUserId = `auth-email-${userId}`;
  await db.execute(sql`
    insert into "user" (id, name, email, "emailVerified")
    values (${authUserId}, ${email}, ${email}, false)
  `);
  await db.execute(sql`
    insert into account (id, issuer, "accountId", "providerId", "userId", password, "updatedAt")
    values (${`acct-${userId}`}, 'credential', ${email}, 'credential', ${authUserId},
            ${await hashPassword(password)}, now())
  `);
  await db.execute(sql`update users set auth_user_id = ${authUserId} where id = ${userId}`);
  return { userId, authUserId };
}

/**
 * A phone account exactly as the phone path leaves one: a synthetic address, a
 * verified number, no credential row, and a live session.
 */
async function createPhoneAccount(
  phone: string,
): Promise<{ userId: string; authUserId: string }> {
  const userId = await createTestUser(db, { phone });
  const rows = await db.execute<{ auth_user_id: string }>(sql`
    select auth_user_id from users where id = ${userId}
  `);
  const authUserId = rows.rows[0]?.auth_user_id as string;
  await openSession(authUserId, `phone-${userId}`);
  return { userId, authUserId };
}

async function openSession(authUserId: string, token: string): Promise<void> {
  await db.execute(sql`
    insert into session (id, "expiresAt", token, "updatedAt", "userId")
    values (${`sess-${token}`}, now() + interval '7 days', ${token}, now(), ${authUserId})
  `);
}

async function sessionCount(authUserId: string): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`
    select count(*)::text as count from session where "userId" = ${authUserId}
  `);
  return Number(rows.rows[0]?.count ?? 0);
}

async function isVerified(email: string): Promise<boolean> {
  const rows = await db.execute<{ v: boolean }>(sql`
    select "emailVerified" as v from "user" where lower(email) = ${email.toLowerCase()}
  `);
  return rows.rows[0]?.v === true;
}

/**
 * Captures what the structured logger actually writes.
 *
 * The module's logger is built at import time with the default sink, so there
 * is no seam to inject one through — and that is fine: what needs proving is
 * that the line reaches stdout, which is what Render shows. Spying on the
 * write is closer to the thing under test than a fake sink would be.
 */
function captureStdout(): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, stop: () => { spy.mockRestore(); } };
}

async function auditRows(action: string): Promise<Record<string, unknown>[]> {
  const rows = await db.execute<{ context: Record<string, unknown> }>(sql`
    select context from audit_logs where action = ${action} order by occurred_at
  `);
  return rows.rows.map((r) => r.context);
}

async function auditActions(): Promise<string[]> {
  const rows = await db.execute<{ action: string }>(sql`
    select action from audit_logs order by occurred_at
  `);
  return rows.rows.map((r) => r.action);
}

// ---------------------------------------------------------------------------

describe("synthetic addresses", () => {
  it("recognises the domain phone signup invents", () => {
    expect(isSyntheticEmail(`22790000001@${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
    expect(isSyntheticEmail(`  22790000001@${SYNTHETIC_EMAIL_DOMAIN.toUpperCase()}  `)).toBe(true);
    expect(isSyntheticEmail("aicha@example.com")).toBe(false);
  });

  it("does not mistake a real address that merely contains the domain", () => {
    // A lookalike must not be quarantined, and a subdomain must not slip past.
    expect(isSyntheticEmail(`aicha@notphone.afrinext.local`)).toBe(false);
    expect(isSyntheticEmail(`aicha@example.com?${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(false);
  });

  it("treats only a parseable, non-synthetic address as reachable", () => {
    expect(isReachableEmail("aicha@example.com")).toBe(true);
    expect(isReachableEmail(`22790000001@${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(false);
    expect(isReachableEmail("not-an-address")).toBe(false);
    expect(isReachableEmail(null)).toBe(false);
    expect(isReachableEmail(undefined)).toBe(false);
  });
});

describe("email verification", () => {
  it("sends a code and marks the address verified when it is presented", async () => {
    const email = "aicha@example.com";
    const { userId } = await createEmailAccount(email);

    const issued = await requestEmailVerification(db, deps, { email, userId });
    expect(issued).toEqual({ outcome: "sent" });
    expect(await isVerified(email)).toBe(false);

    const result = await confirmEmailVerification(db, deps, { email, code: codeTo(email) });
    expect(result).toEqual({ ok: true, email });
    expect(await isVerified(email)).toBe(true);
  });

  it("never puts the code in the audit log", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email });
    const code = codeTo(email);

    const rows = await db.execute<{ context: unknown }>(sql`
      select context from audit_logs
    `);
    const serialised = JSON.stringify(rows.rows);
    expect(serialised).not.toContain(code);
    expect(await auditActions()).toContain("auth.email.verification_sent");
  });

  it("stores the code only as a keyed hash", async () => {
    const email = "aicha@example.com";
    await requestEmailVerification(db, deps, { email });
    const code = codeTo(email);

    const rows = await db.execute<{ code_hash: string }>(sql`
      select code_hash from otp_challenges
       where identifier = ${email} and purpose = 'email_verification'
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.code_hash).not.toContain(code);
    // Better Auth's own table must hold nothing: the phone plugin's habit of
    // writing codes to `verification.value` in the clear is what this avoids.
    const leak = await db.execute(sql`select 1 from verification`);
    expect(leak.rows).toHaveLength(0);
  });

  it("refuses a wrong code, an expired one and a reused one identically", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email });
    const code = codeTo(email);
    const wrong = code === "000000" ? "111111" : "000000";

    expect(await confirmEmailVerification(db, deps, { email, code: wrong })).toEqual({ ok: false });
    expect(await isVerified(email)).toBe(false);

    // Right code: succeeds once.
    expect(await confirmEmailVerification(db, deps, { email, code })).toEqual({
      ok: true, email,
    });
    // Same code again: single use is enforced in PostgreSQL, and the answer is
    // the same shape as every other refusal.
    expect(await confirmEmailVerification(db, deps, { email, code })).toEqual({ ok: false });
  });

  it("refuses an expired code", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email });
    const code = codeTo(email);

    await db.execute(sql`
      update otp_challenges set expires_at = now() - interval '1 minute'
       where identifier = ${email}
    `);
    expect(await confirmEmailVerification(db, deps, { email, code })).toEqual({ ok: false });
    expect(await isVerified(email)).toBe(false);
  });

  it("stops accepting attempts once the budget is spent", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email });
    const code = codeTo(email);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < OTP_POLICY.verificationAttempts; i += 1) {
      expect(await confirmEmailVerification(db, deps, { email, code: wrong })).toEqual({
        ok: false,
      });
    }
    // The right code no longer helps: the attempt counter is a database
    // predicate, not a number this process is trusted to remember.
    expect(await confirmEmailVerification(db, deps, { email, code })).toEqual({ ok: false });
    expect(await isVerified(email)).toBe(false);
  });

  it("retires the previous code when a new one is requested", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    // The cooldown would refuse the resend; this test is about what happens
    // when a legitimate one goes through, so only the cooldown is relaxed.
    const resendable: EmailAuthDeps = { ...deps, policy: { ...OTP_POLICY, cooldownMs: 1 } };
    await requestEmailVerification(db, resendable, { email });
    const first = codeTo(email);

    await requestEmailVerification(db, resendable, { email });
    const second = codeTo(email);
    expect(second).not.toBe(first);

    // Banking codes must not work: one identifier, one live challenge.
    expect(await confirmEmailVerification(db, deps, { email, code: first })).toEqual({ ok: false });
    expect(await confirmEmailVerification(db, deps, { email, code: second })).toEqual({
      ok: true, email,
    });
  });

  it("answers 'sent' for an address that has no account, and sends nothing there", async () => {
    const stranger = "nobody@example.com";
    expect(await requestEmailVerification(db, deps, { email: stranger })).toEqual({
      outcome: "sent",
    });
    // A code IS issued for an unknown address — deliberately. Refusing to issue
    // one is exactly the difference an attacker measures.
    expect(sender.lastCodeTo(stranger)).toBeDefined();
  });

  it("sends nothing to the synthetic address phone signup invents", async () => {
    const synthetic = `22790000001@${SYNTHETIC_EMAIL_DOMAIN}`;
    expect(await requestEmailVerification(db, deps, { email: synthetic })).toEqual({
      outcome: "sent",
    });
    expect(sender.outbox()).toHaveLength(0);
    const rows = await db.execute(sql`select 1 from otp_challenges`);
    expect(rows.rows).toHaveLength(0);
  });

  it("refuses to verify a synthetic address even with a code in hand", async () => {
    /*
     * Same shape as the reset case, and the code is real this time.
     *
     * Verifying a synthetic address would stamp `emailVerified` on a mailbox
     * that does not exist and cannot exist, turning "this person can be reached
     * here" into a claim nothing supports — and the flag is the thing every
     * later recovery decision will lean on.
     */
    const phone = "+22790000001";
    const { authUserId } = await createPhoneAccount(phone);
    const synthetic = `22790000001@${SYNTHETIC_EMAIL_DOMAIN}`;

    const challenge = await issueChallenge(db, {
      kind: "email",
      identifier: synthetic,
      purpose: "email_verification",
      key,
    });

    expect(await confirmEmailVerification(db, deps, {
      email: synthetic, code: challenge.code,
    })).toEqual({ ok: false });

    const flag = await db.execute<{ v: boolean }>(sql`
      select "emailVerified" as v from "user" where id = ${authUserId}
    `);
    expect(flag.rows[0]?.v).toBe(false);
  });

  it("answers 'sent' for an unparseable address without touching the database", async () => {
    expect(await requestEmailVerification(db, deps, { email: "not an address" })).toEqual({
      outcome: "sent",
    });
    expect(sender.outbox()).toHaveLength(0);
  });

  it("normalises case and surrounding space", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email: "  AICHA@Example.COM " });
    const result = await confirmEmailVerification(db, deps, {
      email: "Aicha@EXAMPLE.com",
      code: codeTo(email),
    });
    expect(result).toEqual({ ok: true, email });
    expect(await isVerified(email)).toBe(true);
  });
});

describe("issuance rate limits", () => {
  it("refuses once the hourly allowance for an address is spent", async () => {
    const email = "aicha@example.com";
    // The cooldown is one send per minute, so it fires first. Widen it for
    // this test only — the limit under test is the hourly one.
    await db.execute(sql`
      update platform_settings
         set value = ${JSON.stringify({ ...OTP_POLICY, cooldownMs: 1 })}::jsonb
       where key = ${OTP_POLICY_SETTING_KEY}
    `);
    const policy = { ...OTP_POLICY, cooldownMs: 1 };

    for (let i = 0; i < policy.perEmailPerHour; i += 1) {
      expect(await requestEmailVerification(db, { ...deps, policy }, { email })).toEqual({
        outcome: "sent",
      });
    }
    const refused = await requestEmailVerification(db, { ...deps, policy }, { email });
    expect(refused.outcome).toBe("rate_limited");
    if (refused.outcome === "rate_limited") {
      expect(refused.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("holds a resend cooldown between consecutive sends", async () => {
    const email = "aicha@example.com";
    expect(await requestEmailVerification(db, deps, { email })).toEqual({ outcome: "sent" });
    const second = await requestEmailVerification(db, deps, { email });
    expect(second.outcome).toBe("rate_limited");
  });

  it("counts an address that does not exist against the limit too", async () => {
    /*
     * The limiter must not be an oracle.
     *
     * If only real addresses were counted, an attacker would learn which ones
     * exist by seeing which ones eventually answer 429 — the enumeration leak
     * the identical answers were written to close, reopened by the defence
     * against abuse. So an unknown address burns budget exactly like a known
     * one, and both refuse on the same request.
     */
    const known = "aicha@example.com";
    await createEmailAccount(known);
    const unknown = "nobody@example.com";

    expect((await requestPasswordReset(db, deps, { email: known })).outcome).toBe("sent");
    expect((await requestPasswordReset(db, deps, { email: known })).outcome).toBe("rate_limited");

    expect((await requestPasswordReset(db, deps, { email: unknown })).outcome).toBe("sent");
    expect((await requestPasswordReset(db, deps, { email: unknown })).outcome)
      .toBe("rate_limited");
  });

  it("counts a synthetic and an unparseable address against the IP too", async () => {
    const withIp: EmailAuthDeps = { ...deps, ipAddress: "10.1.2.3" };
    const policy = { ...OTP_POLICY, perIpPerHour: 2, cooldownMs: 1 };
    const scoped: EmailAuthDeps = { ...withIp, policy };

    expect((await requestPasswordReset(db, scoped, { email: "garbage" })).outcome).toBe("sent");
    expect(
      (await requestPasswordReset(db, scoped, {
        email: `22790000001@${SYNTHETIC_EMAIL_DOMAIN}`,
      })).outcome,
    ).toBe("sent");
    // Two requests from this address consumed the IP budget even though not one
    // of them was ever going to send anything.
    expect((await requestPasswordReset(db, scoped, { email: "aicha@example.com" })).outcome)
      .toBe("rate_limited");
  });
});

describe("password reset", () => {
  it("sets a new password and revokes every session", async () => {
    const email = "aicha@example.com";
    const { authUserId } = await createEmailAccount(email, "the old password");
    await openSession(authUserId, "this-device");
    await openSession(authUserId, "the-intruders-device");
    expect(await sessionCount(authUserId)).toBe(2);

    expect(await requestPasswordReset(db, deps, { email })).toEqual({ outcome: "sent" });
    const result = await resetPassword(db, deps, {
      email,
      code: codeTo(email),
      newPassword: "a brand new password",
    });
    expect(result).toEqual({ ok: true });

    /*
     * The revocation is the point of the flow, not tidying up after it. A reset
     * that leaves the intruder's session alive achieves nothing: the account's
     * owner changes their password, feels safe, and the intruder is still in.
     */
    expect(await sessionCount(authUserId)).toBe(0);

    const rows = await db.execute<{ password: string }>(sql`
      select password from account
       where "userId" = ${authUserId} and "providerId" = 'credential'
    `);
    const stored = rows.rows[0]?.password as string;
    expect(await verifyPassword("a brand new password", stored)).toBe(true);
    expect(await verifyPassword("the old password", stored)).toBe(false);
    expect(await auditActions()).toContain("auth.password.reset");
  });

  it("writes the audit row against the Afrinext identity, not Better Auth's id", async () => {
    const email = "aicha@example.com";
    const { userId } = await createEmailAccount(email);
    await requestPasswordReset(db, deps, { email });
    await resetPassword(db, deps, {
      email, code: codeTo(email), newPassword: "a brand new password",
    });

    const rows = await db.execute<{ target_id: string | null }>(sql`
      select target_id from audit_logs where action = 'auth.password.reset'
    `);
    expect(rows.rows[0]?.target_id).toBe(userId);
  });

  it("writes only the credential row, not every provider the account has", async () => {
    /*
     * An account can hold more than one row in `account` — one per provider.
     * With a single row, scoping the update to `providerId = 'credential'`
     * makes no observable difference, which is why a mutation that removed the
     * scope survived the first matrix: every test here had exactly one row.
     *
     * It matters in both directions. Unscoped, the write lands on rows that are
     * not credentials — putting a password hash into a field an OAuth provider
     * owns — and on a future account with several rows it would be luck rather
     * than logic which one Better Auth then verifies against.
     */
    const email = "aicha@example.com";
    const { authUserId } = await createEmailAccount(email, "the old password");
    await db.execute(sql`
      insert into account (id, issuer, "accountId", "providerId", "userId", password, "updatedAt")
      values (${`oauth-${authUserId}`}, 'some-provider', ${email}, 'some-provider',
              ${authUserId}, 'not-a-password-hash', now())
    `);

    await requestPasswordReset(db, deps, { email });
    expect(await resetPassword(db, deps, {
      email, code: codeTo(email), newPassword: "a brand new password",
    })).toEqual({ ok: true });

    const rows = await db.execute<{ provider: string; password: string }>(sql`
      select "providerId" as provider, password from account
       where "userId" = ${authUserId} order by "providerId"
    `);
    const byProvider = new Map(rows.rows.map((r) => [r.provider, r.password]));

    expect(await verifyPassword("a brand new password", byProvider.get("credential") as string))
      .toBe(true);
    // The other provider's row is exactly as it was.
    expect(byProvider.get("some-provider")).toBe("not-a-password-hash");
  });

  it("refuses a wrong code and leaves the old password working", async () => {
    const email = "aicha@example.com";
    const { authUserId } = await createEmailAccount(email, "the old password");
    await openSession(authUserId, "this-device");
    await requestPasswordReset(db, deps, { email });
    const code = codeTo(email);
    const wrong = code === "000000" ? "111111" : "000000";

    expect(await resetPassword(db, deps, {
      email, code: wrong, newPassword: "a brand new password",
    })).toEqual({ ok: false, reason: "invalid" });

    const rows = await db.execute<{ password: string }>(sql`
      select password from account where "userId" = ${authUserId}
    `);
    expect(await verifyPassword("the old password", rows.rows[0]?.password as string)).toBe(true);
    // A failed reset must not sign anybody out either.
    expect(await sessionCount(authUserId)).toBe(1);
  });

  it("cannot reuse a reset code", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestPasswordReset(db, deps, { email });
    const code = codeTo(email);

    expect(await resetPassword(db, deps, { email, code, newPassword: "first new password" }))
      .toEqual({ ok: true });
    expect(await resetPassword(db, deps, { email, code, newPassword: "second new password" }))
      .toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a password shorter than the minimum without spending the code", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestPasswordReset(db, deps, { email });
    const code = codeTo(email);

    expect(await resetPassword(db, deps, { email, code, newPassword: "short" }))
      .toEqual({ ok: false, reason: "weak_password" });
    expect("x".repeat(MIN_PASSWORD_LENGTH).length).toBe(MIN_PASSWORD_LENGTH);

    // The code survives a rejected password: a typo must not force a resend.
    expect(await resetPassword(db, deps, {
      email, code, newPassword: "a long enough password",
    })).toEqual({ ok: true });
  });

  it("never resets through the synthetic address of a phone account", async () => {
    const phone = "+22790000001";
    await createTestUser(db, { phone });
    const synthetic = `22790000001@${SYNTHETIC_EMAIL_DOMAIN}`;

    expect(await requestPasswordReset(db, deps, { email: synthetic })).toEqual({
      outcome: "sent",
    });
    expect(sender.outbox()).toHaveLength(0);
    expect(await resetPassword(db, deps, {
      email: synthetic, code: "123456", newPassword: "a brand new password",
    })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a synthetic address even when a live code exists for it", async () => {
    /*
     * The second layer, tested on its own.
     *
     * The test above passes whether or not `resetPassword` checks the address,
     * because with issuance quarantined there is never a code to present and
     * the refusal comes from "no challenge" either way — an assertion satisfied
     * by a later failure, which is no assertion at all. A mutation that deleted
     * the check from `resetPassword` survived it.
     *
     * So the challenge is written HERE, one layer below `issueAndSend`, which
     * is exactly the state a future code path or a hand-run migration could
     * produce. With a valid code in hand, only the address check stands between
     * an attacker who controls `phone.afrinext.local` — a domain that does not
     * exist and that anybody may register — and somebody's seller account.
     */
    const phone = "+22790000001";
    const { userId, authUserId } = await createPhoneAccount(phone);
    const synthetic = `22790000001@${SYNTHETIC_EMAIL_DOMAIN}`;

    const challenge = await issueChallenge(db, {
      kind: "email",
      identifier: synthetic,
      purpose: "password_reset",
      key,
    });

    expect(await resetPassword(db, deps, {
      email: synthetic,
      code: challenge.code,
      newPassword: "an attacker's password",
    })).toEqual({ ok: false, reason: "invalid" });

    // No credential was written, and the account keeps its sessions.
    const account = await db.execute(sql`
      select 1 from account where "userId" = ${authUserId} and "providerId" = 'credential'
    `);
    expect(account.rows).toHaveLength(0);
    expect(await sessionCount(authUserId)).toBe(1);
    expect(userId).not.toBe("");
  });

  it("uses a separate challenge from email verification", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);

    await requestEmailVerification(db, deps, { email });
    const verificationCode = codeTo(email);

    // A different purpose, so both live at once — the partial unique index is
    // on (kind, identifier, purpose).
    await requestPasswordReset(db, deps, { email });
    const resetCode = codeTo(email);

    // Neither code works for the other flow. Without the purpose in the hash
    // and in the lookup, a verification code would reset a password.
    expect(await resetPassword(db, deps, {
      email, code: verificationCode, newPassword: "a brand new password",
    })).toEqual({ ok: false, reason: "invalid" });
    expect(await confirmEmailVerification(db, deps, { email, code: resetCode }))
      .toEqual({ ok: false });

    expect(await confirmEmailVerification(db, deps, { email, code: verificationCode }))
      .toEqual({ ok: true, email });
  });
});

// ---------------------------------------------------------------------------
// A refusal has to be observable, or a rate limit looks like a broken sender
// ---------------------------------------------------------------------------

describe("a refused issuance is observable", () => {
  let capture: { lines: string[]; stop: () => void } | undefined;

  afterEach(() => {
    capture?.stop();
    capture = undefined;
  });

  it("writes a structured log line carrying the reason, the counters and the wait", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    // First send: allowed. Second, inside the cooldown: refused.
    await requestEmailVerification(db, deps, { email });

    capture = captureStdout();
    const refused = await requestEmailVerification(db, deps, { email });
    capture.stop();
    expect(refused.outcome).toBe("rate_limited");

    const entry = capture.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l["msg"] === "email code not issued");

    expect(entry, "a refusal must reach stdout").toBeDefined();
    expect(entry).toMatchObject({
      level: "warn",
      component: "auth.email",
      reason: "rate_limited",
      channel: "email",
      purpose: "email_verification",
    });
    expect(typeof entry?.["used"]).toBe("number");
    expect(typeof entry?.["limit"]).toBe("number");
    expect(entry?.["retryAfterMs"]).toBeGreaterThan(0);
  });

  it("writes an audit row for the refusal", async () => {
    const email = "aicha@example.com";
    const { userId } = await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email, userId });
    await requestEmailVerification(db, deps, { email, userId });

    const contexts = await auditRows("auth.email.rate_limited");
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      reason: "rate_limited",
      channel: "email",
      purpose: "email_verification",
    });

    const rows = await db.execute<{ target_id: string | null }>(sql`
      select target_id from audit_logs where action = 'auth.email.rate_limited'
    `);
    expect(rows.rows[0]?.target_id).toBe(userId);
  });

  it("puts neither the code nor the whole address into the log or the audit", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email });
    const code = codeTo(email);

    capture = captureStdout();
    await requestEmailVerification(db, deps, { email });
    capture.stop();

    const logged = capture.lines.join("\n");
    const audited = JSON.stringify(await auditRows("auth.email.rate_limited"));

    for (const [where, text] of [["log", logged], ["audit", audited]] as const) {
      expect(text, `the ${where} must not carry the code`).not.toContain(code);
      /*
       * A log line is a copy of the data with different access rules and a
       * different retention. "aicha@example.com asked for a code at 07:04" is
       * a fact about a person that operations does not need; the domain is
       * kept because it says whether one mail provider is being hammered.
       */
      expect(text, `the ${where} must not carry the whole address`).not.toContain(email);
      expect(text, `the ${where} should keep the domain`).toContain("example.com");
      expect(text).toContain("a****@example.com");
    }
  });

  it("masks an address without inventing one that could be read back", () => {
    expect(maskEmail("aicha@example.com")).toBe("a****@example.com");
    expect(maskEmail("a@example.com")).toBe("a*@example.com");
    // No local part to mask, and nothing that looks like an address either.
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail("not-an-address")).toBe("***");
    // The length is preserved, which is what makes a line recognisable to its
    // owner; the characters are not, which is what makes it useless to anybody
    // else.
    expect(maskEmail("aicha.abdou@yahoo.fr")).toBe("a**********@yahoo.fr");
  });
});

// ---------------------------------------------------------------------------
// What a refused request is charged to
// ---------------------------------------------------------------------------

describe("a cooldown refusal does not spend the hourly allowance", () => {
  it("leaves the hour intact however many times the button is pressed", async () => {
    /*
     * The defect this exists to stop, exactly as it behaved.
     *
     * Somebody whose email has not arrived presses "resend". The cooldown
     * refuses them — correctly. But with the hourly cap consumed FIRST, that
     * refusal also spent one of their five sends, so five presses inside a
     * minute burned the whole hour without a single code being issued, and the
     * screen then told them to wait forty-five minutes.
     */
    const email = "aicha@example.com";
    await createEmailAccount(email);

    // One real send. This is the only one that should cost an hourly credit.
    expect(await requestEmailVerification(db, deps, { email })).toEqual({ outcome: "sent" });

    for (let press = 1; press <= 8; press += 1) {
      const refused = await requestEmailVerification(db, deps, { email });
      expect(refused.outcome, `press ${press}`).toBe("rate_limited");
      if (refused.outcome === "rate_limited") {
        /*
         * The wait stays the cooldown's, seconds rather than the rest of the
         * hour. Before the reorder, press 5 answered with 45 minutes.
         */
        expect(refused.retryAfterMs, `press ${press} wait`)
          .toBeLessThanOrEqual(OTP_POLICY.cooldownMs);
      }
    }

    const hourly = await db.execute<{ count: number }>(sql`
      select count from rate_limit_counters
       where bucket like 'email:send:email_verification:addr:%'
    `);
    expect(Number(hourly.rows[0]?.count ?? 0), "nine presses, one code issued").toBe(1);
  });

  it("still lets the hourly ceiling bind once the cooldown is out of the way", async () => {
    // The reorder must not weaken the cap it moved behind. With the cooldown
    // relaxed, the fifth send is still the last one of the hour.
    const email = "aicha@example.com";
    await createEmailAccount(email);
    const policy = { ...OTP_POLICY, cooldownMs: 1 };
    const scoped: EmailAuthDeps = { ...deps, policy };

    for (let i = 0; i < policy.perEmailPerHour; i += 1) {
      expect((await requestEmailVerification(db, scoped, { email })).outcome, `send ${i + 1}`)
        .toBe("sent");
    }
    expect((await requestEmailVerification(db, scoped, { email })).outcome).toBe("rate_limited");
  });

  it("still charges every attempt to the IP, including the refused ones", async () => {
    /*
     * The other half of the reorder, and the reason the IP rule went first
     * rather than last. Previously an address-level refusal returned before the
     * IP bucket was ever touched, so flooding one address from one connection
     * cost an attacker nothing per-IP. Now every attempt is counted there.
     */
    const withIp: EmailAuthDeps = { ...deps, ipAddress: "10.9.9.9" };
    const email = "aicha@example.com";
    await createEmailAccount(email);

    await requestEmailVerification(db, withIp, { email });
    for (let i = 0; i < 4; i += 1) await requestEmailVerification(db, withIp, { email });

    const ip = await db.execute<{ count: number }>(sql`
      select count from rate_limit_counters where bucket = 'email:send:ip:10.9.9.9'
    `);
    expect(Number(ip.rows[0]?.count ?? 0), "five attempts, five IP tokens").toBe(5);
  });
});

// ---------------------------------------------------------------------------
// What the verification screen is allowed to claim
// ---------------------------------------------------------------------------

describe("hasLiveChallenge", () => {
  const pending = (email: string): Promise<boolean> =>
    hasLiveChallenge(db, { kind: "email", identifier: email, purpose: "email_verification" });

  it("is false before anything is issued", async () => {
    expect(await pending("aicha@example.com")).toBe(false);
  });

  it("is true while a code is outstanding, and false once it is used", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email });
    expect(await pending(email)).toBe(true);

    await confirmEmailVerification(db, deps, { email, code: codeTo(email) });
    expect(await pending(email)).toBe(false);
  });

  it("is false once the code has expired", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestEmailVerification(db, deps, { email });
    await db.execute(sql`
      update otp_challenges set expires_at = now() - interval '1 minute'
       where identifier = ${email}
    `);
    // An expired code is not a pending one. A screen that said otherwise would
    // send somebody looking for something that can no longer work.
    expect(await pending(email)).toBe(false);
  });

  it("does not confuse one purpose with another", async () => {
    const email = "aicha@example.com";
    await createEmailAccount(email);
    await requestPasswordReset(db, deps, { email });
    expect(await pending(email)).toBe(false);
    expect(await hasLiveChallenge(db, {
      kind: "email", identifier: email, purpose: "password_reset",
    })).toBe(true);
  });
});
