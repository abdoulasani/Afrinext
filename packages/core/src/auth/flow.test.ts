import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getPool, type Database } from "@afrinext/db";
import { authorize, can } from "../authz";
import { PermissionDeniedError } from "../errors";
import { ensureReferenceData, resetData, testDb } from "../test/harness";
import { createAuth } from "./better-auth";
import { ElevationRequiredError } from "./errors";
import { ConsoleSender } from "./messaging";
import {
  loadSession, markElevated, requireElevation, resolveActor,
  revokeAllSessionsForUser, revokeSession,
} from "./session-bridge";

let db: Database;
let sender: ConsoleSender;
let auth: ReturnType<typeof createAuth>;

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
    secret: "test-secret-not-used-for-anything-real-0123456789",
  });
});

/** Drives a full phone sign-in and returns the resulting session. */
async function signInByPhone(phone: string): Promise<{ sessionId: string; authUserId: string }> {
  await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
  const code = sender.lastCodeTo(phone);
  expect(code, "a code should have been sent").toBeDefined();

  await auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code: code as string } });

  const rows = await db.execute<{ id: string; userId: string }>(sql`
    select s.id, s."userId" from session s
      join "user" u on u.id = s."userId"
     where u."phoneNumber" = ${phone}
     order by s."createdAt" desc limit 1
  `);
  const session = rows.rows[0];
  expect(session, "verification should have created a session").toBeDefined();
  return { sessionId: session!.id, authUserId: session!.userId };
}

describe("phone sign-in, end to end", () => {
  it("registers, signs in, and provisions the domain identity", async () => {
    const phone = "+22790000101";
    const { sessionId, authUserId } = await signInByPhone(phone);

    // A credential exists...
    const users = await db.execute<{ id: string; auth_user_id: string }>(sql`
      select id, auth_user_id from users where auth_user_id = ${authUserId}
    `);
    // ...and so does the Afrinext domain identity everything else is keyed on.
    expect(users.rows).toHaveLength(1);

    const actor = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });
    expect(actor?.userId).toBe(users.rows[0]?.id);

    // A new user gets `member` and nothing more.
    expect(await can(db, actor!, "wallet.read_own")).toBe(true);
    expect(await can(db, actor!, "withdrawal.approve")).toBe(false);
    expect(await can(db, actor!, "ledger.read")).toBe(false);
  });

  it("writes an audit trail for the codes it sends and the identity it creates", async () => {
    const phone = "+22790000102";
    await signInByPhone(phone);

    const rows = await db.execute<{ action: string; context: unknown }>(sql`
      select action, context from audit_logs order by occurred_at
    `);
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toContain("auth.otp.sent");
    expect(actions).toContain("auth.user.provisioned");

    // The code itself must never be audited.
    expect(JSON.stringify(rows.rows)).not.toContain(sender.lastCodeTo(phone) ?? "__none__");
  });

  it("refuses a wrong code", async () => {
    const phone = "+22790000103";
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
    await expect(
      auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code: "000000" } }),
    ).rejects.toThrow();
  });

  it("rate-limits code requests, so issuance is never unlimited", async () => {
    const phone = "+22790000104";
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
    // The cooldown makes an immediate second request a refusal — every SMS costs
    // money, and unlimited issuance makes attempt limits meaningless.
    const refusal = await auth.api
      .sendPhoneNumberOTP({ body: { phoneNumber: phone } })
      .then(() => undefined, (e: unknown) => e);
    expect(refusal, "a second immediate request must be refused").toBeDefined();

    // And refused as a 429 the caller can act on, not a 500. Asserting the
    // status is the point: an unrecognised throw out of a Better Auth callback
    // becomes a bare 500, which is indistinguishable from a server fault.
    const status = (refusal as { statusCode?: number; body?: { code?: string } });
    expect(status.statusCode).toBe(429);
    expect(status.body?.code).toBe("ratelimit.exceeded");

    const audits = await db.execute<{ action: string }>(
      sql`select action from audit_logs where action = 'auth.otp.rate_limited'`,
    );
    expect(audits.rows.length).toBeGreaterThan(0);
  });
});

describe("sessions are revocable", () => {
  it("kills a single session", async () => {
    const { sessionId, authUserId } = await signInByPhone("+22790000105");
    expect(await loadSession(db, sessionId)).toBeDefined();

    const actor = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });
    expect(await revokeSession(db, sessionId, actor!.userId)).toBe(true);

    // Revocation is one statement — the reason sessions are rows, not tokens.
    expect(await loadSession(db, sessionId)).toBeUndefined();
  });

  it("signs a person out everywhere, which is what a stolen phone needs", async () => {
    const phone = "+22790000106";
    const { sessionId, authUserId } = await signInByPhone(phone);
    const actor = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });

    // A second device. Inserted directly rather than by signing in again: the
    // OTP cooldown would refuse a second code, and this test is about
    // revocation, not issuance.
    await db.execute(sql`
      insert into session (id, "expiresAt", token, "updatedAt", "userId")
      values ('second-device-session', now() + interval '30 days',
              'second-device-token', now(), ${authUserId})
    `);

    const revoked = await revokeAllSessionsForUser(db, actor!.userId, actor!.userId);
    expect(revoked).toBeGreaterThanOrEqual(1);
    const remaining = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from session where "userId" = ${authUserId}
    `);
    expect(Number(remaining.rows[0]?.count)).toBe(0);
  });

  it("gives a suspended account no actor at all", async () => {
    const { sessionId, authUserId } = await signInByPhone("+22790000107");
    await db.execute(sql`update users set status = 'suspended' where auth_user_id = ${authUserId}`);
    // The credential still exists; the ability to act does not.
    expect(await resolveActor(db, { sessionId, authUserId, elevatedAt: null })).toBeUndefined();
  });
});

describe("elevation guards money", () => {
  it("requires a fresh re-verification even when the permission is held", async () => {
    const { sessionId, authUserId } = await signInByPhone("+22790000108");
    const actor = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });

    // Holding a permission says "allowed in principle"; elevation says
    // "present right now". Payouts need both.
    expect(() => requireElevation(actor!, "withdrawal.request")).toThrow(ElevationRequiredError);

    await markElevated(db, sessionId, actor!.userId);
    const session = await loadSession(db, sessionId);
    const elevatedActor = await resolveActor(db, session!);
    expect(elevatedActor?.elevated).toBe(true);
    expect(() => requireElevation(elevatedActor!, "withdrawal.request")).not.toThrow();
  });

  it("stops honouring an elevation once the window closes", async () => {
    const { sessionId } = await signInByPhone("+22790000109");
    await db.execute(sql`update session set "elevatedAt" = now() - interval '30 minutes' where id = ${sessionId}`);
    const session = await loadSession(db, sessionId);
    const actor = await resolveActor(db, session!);
    expect(actor?.elevated).toBe(false);
  });
});

describe("authentication is never authorization", () => {
  it("gives a signed-in member no administrative or financial power", async () => {
    const { sessionId, authUserId } = await signInByPhone("+22790000110");
    const actor = await resolveActor(db, { sessionId, authUserId, elevatedAt: null });

    // The whole point of the separation: a valid session proves identity and
    // grants nothing beyond what the role assignments say.
    await expect(authorize(db, actor!, "ledger.adjust")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(db, actor!, "admin.role.grant")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(db, actor!, "withdrawal.approve")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(db, actor!, "wallet.read_own")).resolves.toBeUndefined();
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
