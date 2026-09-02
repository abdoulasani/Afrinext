import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPool, type Database } from "@afrinext/db";
import { can } from "../authz";
import { activateAccountWithConsent } from "../consent";
import { chooseProgramme, programmeState } from "../programme";
import { ensureReferenceData, resetData, testDb } from "../test/harness";
import { createAuth } from "./better-auth";
import { ConsoleSender } from "./messaging";
import { deriveOtpKey } from "./otp";
import { resolveActor } from "./session-bridge";
import {
  SYNTHETIC_EMAIL_DOMAIN, confirmEmailVerification, isReachableEmail,
  requestEmailVerification, requestPasswordReset, resetPassword,
} from "./email-identity";

const SECRET = "test-secret-not-used-for-anything-real-0123456789";

let db: Database;
let sender: ConsoleSender;
let auth: ReturnType<typeof createAuth>;
const key = deriveOtpKey(SECRET);

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  sender = new ConsoleSender();
  auth = createAuth({
    pool: getPool(),
    db,
    sender,
    baseUrl: "http://localhost:3000",
    secret: SECRET,
  });
});

/** Everything the domain needs to know about a Better Auth account. */
async function identityFor(email: string): Promise<{
  userId: string; authUserId: string; status: string; emailVerified: boolean;
}> {
  const rows = await db.execute<{
    id: string; auth_user_id: string; status: string; v: boolean;
  }>(sql`
    select u.id, u.auth_user_id, u.status, a."emailVerified" as v
      from users u join "user" a on a.id = u.auth_user_id
     where lower(a.email) = ${email.toLowerCase()}
  `);
  const row = rows.rows[0];
  expect(row, `no account for ${email}`).toBeDefined();
  const found = row as NonNullable<typeof row>;
  return {
    userId: found.id,
    authUserId: found.auth_user_id,
    status: found.status,
    emailVerified: found.v,
  };
}

/** The session cookie a browser would send back, taken from `Set-Cookie`. */
function cookieFor(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

async function sessionCount(authUserId: string): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`
    select count(*)::text as count from session where "userId" = ${authUserId}
  `);
  return Number(rows.rows[0]?.count ?? 0);
}

async function signUp(email: string, password = "correct horse battery"): Promise<void> {
  await auth.api.signUpEmail({ body: { email, password, name: "Aïcha Test" } });
}

async function signInReturningSession(
  email: string,
  password: string,
): Promise<{ sessionId: string; authUserId: string }> {
  await auth.api.signInEmail({ body: { email, password } });
  const rows = await db.execute<{ id: string; userId: string }>(sql`
    select s.id, s."userId" from session s
      join "user" u on u.id = s."userId"
     where lower(u.email) = ${email.toLowerCase()}
     order by s."createdAt" desc limit 1
  `);
  const row = rows.rows[0];
  expect(row, "sign-in should have created a session").toBeDefined();
  const found = row as NonNullable<typeof row>;
  return { sessionId: found.id, authUserId: found.userId };
}

// ---------------------------------------------------------------------------

describe("signing up with an email address", () => {
  it("provisions the Afrinext identity, pending consent, with the member role", async () => {
    await signUp("aicha@example.com");
    const identity = await identityFor("aicha@example.com");

    /*
     * `pending_consent` is the whole signup gate, and it is the SAME gate the
     * phone path meets. Email signup did not get its own, weaker one.
     */
    expect(identity.status).toBe("pending_consent");
    expect(identity.emailVerified).toBe(false);

    const roles = await db.execute<{ key: string }>(sql`
      select r.key from role_assignments ra join roles r on r.id = ra.role_id
       where ra.user_id = ${identity.userId}
    `);
    expect(roles.rows.map((r) => r.key)).toEqual(["member"]);
  });

  it("resolves to no actor until the terms are accepted", async () => {
    await signUp("aicha@example.com");
    const { sessionId, authUserId } = await signInReturningSession(
      "aicha@example.com", "correct horse battery",
    );

    // A session exists and grants nothing.
    const before = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });
    expect(before).toBeUndefined();

    const identity = await identityFor("aicha@example.com");
    await activateAccountWithConsent(db, identity.userId, { method: "signup" });

    const after = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });
    expect(after?.userId).toBe(identity.userId);
  });

  it("creates nothing and issues nothing for a second signup on the same address", async () => {
    await signUp("aicha@example.com", "the first password");

    /*
     * Better Auth does NOT throw here. It answers a signup on an existing
     * address with a success shape that creates no row and carries no token —
     * enumeration-safe on its own terms, and a trap for a caller that reads
     * "no error" as "account created and signed in".
     *
     * This test pins the two things that actually matter: no second row, and
     * no session. The signup screen tells the two apart the only way available
     * from outside — by trying the credentials — and says the address is
     * taken when they do not work.
     */
    const second = await auth.api.signUpEmail({
      body: { email: "aicha@example.com", password: "an attacker's password", name: "Mallory" },
    }) as { token: string | null };
    expect(second.token).toBeNull();

    const rows = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from "user"
    `);
    expect(Number(rows.rows[0]?.count)).toBe(1);

    const identity = await identityFor("aicha@example.com");
    expect(await sessionCount(identity.authUserId)).toBe(0);

    // And the password was NOT overwritten by the second attempt.
    await expect(
      auth.api.signInEmail({
        body: { email: "aicha@example.com", password: "an attacker's password" },
      }),
    ).rejects.toBeDefined();
    const legitimate = await signInReturningSession("aicha@example.com", "the first password");
    expect(legitimate.sessionId).toBeTruthy();
  });

  it("refuses a password shorter than the configured minimum", async () => {
    await expect(signUp("aicha@example.com", "short")).rejects.toBeDefined();
    const rows = await db.execute(sql`select 1 from "user"`);
    expect(rows.rows).toHaveLength(0);
  });

  it("does not sign anybody in as a side effect of signing up", async () => {
    // autoSignIn is off: consent has not been given, so a session at this point
    // would be a session for an account that cannot use it.
    await signUp("aicha@example.com");
    const identity = await identityFor("aicha@example.com");
    expect(await sessionCount(identity.authUserId)).toBe(0);
  });

  it("refuses a wrong password, and says nothing about whether the account exists", async () => {
    await signUp("aicha@example.com");
    await expect(
      auth.api.signInEmail({ body: { email: "aicha@example.com", password: "wrong password" } }),
    ).rejects.toBeDefined();
    await expect(
      auth.api.signInEmail({ body: { email: "nobody@example.com", password: "correct horse battery" } }),
    ).rejects.toBeDefined();
  });
});

describe("the dashboard before verification", () => {
  it("lets a consented but unverified account act", async () => {
    await signUp("aicha@example.com");
    const { sessionId, authUserId } = await signInReturningSession(
      "aicha@example.com", "correct horse battery",
    );
    const identity = await identityFor("aicha@example.com");
    await activateAccountWithConsent(db, identity.userId, { method: "signup" });

    const actor = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });
    expect(actor).toBeDefined();

    /*
     * Verification is a trust signal, not the gate. An unverified account
     * resolves to a real actor with its real permissions — deliberately, and
     * this test is what stops a later change from quietly making it a gate.
     */
    expect((await identityFor("aicha@example.com")).emailVerified).toBe(false);
    expect(await can(db, { userId: identity.userId }, "profile.read")).toBe(true);
  });

  it("changes no permission when the address is verified", async () => {
    await signUp("aicha@example.com");
    const identity = await identityFor("aicha@example.com");
    await activateAccountWithConsent(db, identity.userId, { method: "signup" });

    const before = await can(db, { userId: identity.userId }, "store.create");
    await requestEmailVerification(db, { sender, key }, { email: "aicha@example.com" });
    const code = sender.lastCodeTo("aicha@example.com") as string;
    expect(await confirmEmailVerification(db, { sender, key }, {
      email: "aicha@example.com", code,
    })).toEqual({ ok: true, email: "aicha@example.com" });

    expect((await identityFor("aicha@example.com")).emailVerified).toBe(true);
    expect(await can(db, { userId: identity.userId }, "store.create")).toBe(before);
    // And the account status — the actual gate — is untouched by verifying.
    expect((await identityFor("aicha@example.com")).status).toBe("active");
  });
});

describe("signing out", () => {
  it("deletes the session row, not just the cookie", async () => {
    await signUp("aicha@example.com");

    const response = await auth.api.signInEmail({
      body: { email: "aicha@example.com", password: "correct horse battery" },
      asResponse: true,
    });
    const identity = await identityFor("aicha@example.com");
    await activateAccountWithConsent(db, identity.userId, { method: "signup" });

    const opened = await db.execute<{ id: string }>(sql`
      select id from session where "userId" = ${identity.authUserId}
    `);
    const sessionId = opened.rows[0]?.id as string;
    expect(await resolveActor(db, {
      sessionId, authUserId: identity.authUserId, elevatedAt: null,
    })).toBeDefined();
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie: cookieFor(response) }) }),
    ).not.toBeNull();

    /*
     * Signed out the way the browser does it: with the cookie Better Auth set,
     * signature and all. The row is then gone, so the token is dead for
     * anybody holding it — not merely missing from the browser that asked.
     * `session` is the only session store there is, which is what makes that
     * one DELETE sufficient.
     */
    await auth.api.signOut({ headers: new Headers({ cookie: cookieFor(response) }) });

    expect(await sessionCount(identity.authUserId)).toBe(0);
    /*
     * And the same cookie now resolves to nothing.
     *
     * This is the assertion that matters, not `resolveActor`: that function is
     * handed a session Better Auth has ALREADY authenticated and only turns it
     * into an Afrinext identity, so it would happily answer for a session id
     * that no longer exists. What a returning browser actually meets is
     * `getSession`, and it is the thing that has to say no.
     */
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie: cookieFor(response) }) }),
    ).toBeNull();
  });

  it("leaves the other devices signed in", async () => {
    // Signing out is not a security event on the account; a reset is. This is
    // the line between them, and it is easy to blur in the wrong direction.
    await signUp("aicha@example.com");
    const response = await auth.api.signInEmail({
      body: { email: "aicha@example.com", password: "correct horse battery" },
      asResponse: true,
    });
    await signInReturningSession("aicha@example.com", "correct horse battery");
    const identity = await identityFor("aicha@example.com");
    expect(await sessionCount(identity.authUserId)).toBe(2);

    await auth.api.signOut({ headers: new Headers({ cookie: cookieFor(response) }) });
    expect(await sessionCount(identity.authUserId)).toBe(1);
  });
});

describe("accounts that existed before this milestone", () => {
  /**
   * A phone account, exactly as the phone path creates one: a synthetic address
   * that resolves nowhere, and no credential row at all.
   */
  async function phoneAccount(phone: string): Promise<{ userId: string; authUserId: string }> {
    await auth.api.sendPhoneOtp({ body: { phoneNumber: phone } });
    const code = sender.lastCodeTo(phone) as string;
    await auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code } });
    const rows = await db.execute<{ id: string; auth_user_id: string }>(sql`
      select u.id, u.auth_user_id from users u join "user" a on a.id = u.auth_user_id
       where a."phoneNumber" = ${phone}
    `);
    const row = rows.rows[0] as { id: string; auth_user_id: string };
    return { userId: row.id, authUserId: row.auth_user_id };
  }

  it("still signs in by phone, and keeps its synthetic address untouched", async () => {
    const phone = "+22790000001";
    const { authUserId } = await phoneAccount(phone);

    const rows = await db.execute<{ email: string }>(sql`
      select email from "user" where id = ${authUserId}
    `);
    const address = rows.rows[0]?.email as string;
    expect(address.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
    expect(isReachableEmail(address)).toBe(false);
    // Not rewritten into something that looks real, and not deleted.
    expect(await sessionCount(authUserId)).toBe(1);
  });

  it("cannot be taken over through the reset flow", async () => {
    const phone = "+22790000001";
    const { authUserId } = await phoneAccount(phone);
    const rows = await db.execute<{ email: string }>(sql`
      select email from "user" where id = ${authUserId}
    `);
    const synthetic = rows.rows[0]?.email as string;

    /*
     * The interesting attack: a phone account HAS an address in `user.email`,
     * so a reset flow that only looked the address up would happily send a code
     * to `<digits>@phone.afrinext.local` — a domain that does not exist, which
     * anybody could stand up. The quarantine is what makes this a dead end.
     */
    expect(await requestPasswordReset(db, { sender, key }, { email: synthetic }))
      .toEqual({ outcome: "sent" });
    expect(sender.outbox().filter((m) => m.to === synthetic)).toHaveLength(0);

    expect(await resetPassword(db, { sender, key }, {
      email: synthetic, code: "123456", newPassword: "an attacker's password",
    })).toEqual({ ok: false, reason: "invalid" });

    // No credential was created for it either — the account still has no
    // password, which is correct: it signs in by phone.
    const account = await db.execute(sql`
      select 1 from account where "userId" = ${authUserId} and "providerId" = 'credential'
    `);
    expect(account.rows).toHaveLength(0);
  });

  it("keeps its programme default, its roles and its existing sessions", async () => {
    const phone = "+22790000001";
    const { userId, authUserId } = await phoneAccount(phone);
    await activateAccountWithConsent(db, userId, { method: "signup" });

    // The migration's default, not a value anything had to backfill.
    const state = await programmeState(db, userId);
    expect(state).toEqual({ chosen: "vendeur", subscription: null, entitled: false });

    const roles = await db.execute<{ key: string }>(sql`
      select r.key from role_assignments ra join roles r on r.id = ra.role_id
       where ra.user_id = ${userId}
    `);
    expect(roles.rows.map((r) => r.key)).toContain("member");
    // Sessions opened before the milestone are still live: nothing in this
    // change revokes them, and revoking them would sign out every existing
    // seller for a schema addition.
    expect(await sessionCount(authUserId)).toBe(1);
  });

  it("can take the entrepreneur programme without a second account", async () => {
    const phone = "+22790000001";
    const { userId, authUserId } = await phoneAccount(phone);
    await activateAccountWithConsent(db, userId, { method: "signup" });

    await chooseProgramme(db, { userId, programme: "entrepreneur", actorUserId: userId });

    const state = await programmeState(db, userId);
    expect(state.chosen).toBe("entrepreneur");
    expect(state.subscription?.status).toBe("pending_payment");
    expect(state.entitled).toBe(false);

    // Same identity, same credential, same session. Nothing was re-created.
    const rows = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from users
    `);
    expect(Number(rows.rows[0]?.count)).toBe(1);
    expect(await sessionCount(authUserId)).toBe(1);
  });
});

describe("a password reset ends every session", () => {
  it("signs out the other device, and the current one", async () => {
    await signUp("aicha@example.com");
    const first = await signInReturningSession("aicha@example.com", "correct horse battery");
    await signInReturningSession("aicha@example.com", "correct horse battery");
    expect(await sessionCount(first.authUserId)).toBe(2);

    await requestPasswordReset(db, { sender, key }, { email: "aicha@example.com" });
    const code = sender.lastCodeTo("aicha@example.com") as string;
    expect(await resetPassword(db, { sender, key }, {
      email: "aicha@example.com", code, newPassword: "a brand new password",
    })).toEqual({ ok: true });

    expect(await sessionCount(first.authUserId)).toBe(0);
    expect(await resolveActor(db, {
      sessionId: first.sessionId, authUserId: first.authUserId, elevatedAt: null,
    })).toBeUndefined();
  });

  it("leaves the account signing in with the new password through Better Auth", async () => {
    await signUp("aicha@example.com", "the old password");
    await requestPasswordReset(db, { sender, key }, { email: "aicha@example.com" });
    const code = sender.lastCodeTo("aicha@example.com") as string;
    await resetPassword(db, { sender, key }, {
      email: "aicha@example.com", code, newPassword: "a brand new password",
    });

    /*
     * The end-to-end proof that the hash written by `resetPassword` is one
     * Better Auth verifies: it is Afrinext's own scrypt on both sides, but that
     * is a configuration fact, and a configuration fact deserves a test.
     */
    await expect(
      auth.api.signInEmail({ body: { email: "aicha@example.com", password: "the old password" } }),
    ).rejects.toBeDefined();
    const after = await signInReturningSession("aicha@example.com", "a brand new password");
    expect(after.sessionId).toBeTruthy();
  });
});
