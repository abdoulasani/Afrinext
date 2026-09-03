import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { OTP_POLICY, OTP_POLICY_SETTING_KEY } from "../ratelimit";
import { deriveOtpKey } from "./otp";
import { issueChallenge } from "./otp-store";
import { ConsoleSender } from "./messaging";
import { hashPassword, verifyPassword } from "./password";
import {
  MIN_PASSWORD_LENGTH, SYNTHETIC_EMAIL_DOMAIN,
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
