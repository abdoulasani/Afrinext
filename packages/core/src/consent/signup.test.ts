import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getPool, type Database } from "@afrinext/db";
import { createAuth } from "../auth/better-auth";
import { ConsoleSender } from "../auth/messaging";
import { resolveActor } from "../auth/session-bridge";
import { ConsentRequiredError } from "../errors";
import { ensureReferenceData, resetData, testDb } from "../test/harness";
import {
  accountConsentStatus, ACCOUNT_CONSENT_KINDS, acceptCurrentVersions,
  activateAccountWithConsent, ConsentUnavailableError, currentVersions,
  recordConsent, requireAccountConsent,
} from "./index";

/**
 * Signup consent, driven through the REAL phone OTP flow.
 *
 * These tests do not construct users directly. They sign in the way a person
 * does — request a code, verify it — so that what is asserted about the account
 * afterwards is a property of the actual signup path, not of a fixture that
 * resembles it.
 */
const SECRET = "test-application-secret-0123456789abcdef";

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
    pool: getPool(), db, sender,
    baseUrl: "http://localhost:3000",
    secret: SECRET,
  });
});

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+2279000${String(1000 + phoneCounter)}`;
}

interface SignedUp {
  phone: string;
  userId: string;
  authUserId: string;
  sessionId: string;
  response: { accountStatus?: string; consentRequired?: { kind: string; version: string }[] };
}

/** The real journey: send, verify. Returns what the flow actually produced. */
async function signUp(): Promise<SignedUp> {
  const phone = nextPhone();
  await auth.api.sendPhoneOtp({ body: { phoneNumber: phone } });
  const code = sender.lastCodeTo(phone);
  expect(code, "a code should have been sent").toBeDefined();

  const response = (await auth.api.verifyPhoneOtp({
    body: { phoneNumber: phone, code: code as string },
  })) as SignedUp["response"];

  const rows = await db.execute<{ id: string; auth_user_id: string; session_id: string }>(sql`
    select u.id, u.auth_user_id, s.id as session_id
      from users u
      join "user" au on au.id = u.auth_user_id
      join session s on s."userId" = au.id
     where au."phoneNumber" = ${phone}
     order by s."createdAt" desc limit 1
  `);
  const row = rows.rows[0]!;
  return { phone, userId: row.id, authUserId: row.auth_user_id, sessionId: row.session_id, response };
}

async function publishNewVersion(kind: string, version: string): Promise<void> {
  await db.execute(sql`
    insert into legal_document_versions
      (id, document_id, version, locale, content_hash, effective_from)
    select gen_random_uuid(), d.id, ${version}, v.locale,
           encode(sha256((${version} || v.locale)::bytea), 'hex'), now() - interval '1 minute'
      from legal_documents d
      join legal_document_versions v on v.document_id = d.id
     where d.kind = ${kind} and v.version = '0.0.0-placeholder'
  `);
}

describe("1–2 · a new account is created but not usable", () => {
  it("is pending_consent, and resolves to NO ACTOR", async () => {
    const account = await signUp();

    const status = await db.execute<{ status: string }>(
      sql`select status from users where id = ${account.userId}::uuid`,
    );
    expect(status.rows[0]?.status).toBe("pending_consent");

    // The enforcement, stated plainly: the credential exists, the session
    // exists, and there is no actor. Everything downstream asks for an actor.
    const actor = await resolveActor(db, {
      sessionId: account.sessionId, authUserId: account.authUserId, elevatedAt: null,
    });
    expect(actor).toBeUndefined();
  });

  it("names both required documents, and nothing has been accepted", async () => {
    const account = await signUp();
    expect(account.response.accountStatus).toBe("pending_consent");
    expect(account.response.consentRequired?.map((c) => c.kind).sort())
      .toEqual(["privacy_policy", "terms_of_use"]);

    const records = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from consent_records where user_id = ${account.userId}::uuid
    `);
    expect(Number(records.rows[0]!.n)).toBe(0);
  });

  it("stays unusable when only ONE of the two is accepted", async () => {
    const account = await signUp();

    // Terms of use alone.
    const [terms] = await currentVersions(db, ["terms_of_use"], { locale: "fr" });
    await recordConsent(db, {
      userId: account.userId, documentVersionId: terms!.versionId, method: "signup",
    });
    await expect(requireAccountConsent(db, account.userId))
      .rejects.toBeInstanceOf(ConsentRequiredError);

    // And the other way round, on a second account.
    const second = await signUp();
    const [privacy] = await currentVersions(db, ["privacy_policy"], { locale: "fr" });
    await recordConsent(db, {
      userId: second.userId, documentVersionId: privacy!.versionId, method: "signup",
    });
    await expect(requireAccountConsent(db, second.userId))
      .rejects.toBeInstanceOf(ConsentRequiredError);

    // Neither partial acceptance activated anything.
    for (const id of [account.userId, second.userId]) {
      const status = await db.execute<{ status: string }>(
        sql`select status from users where id = ${id}::uuid`,
      );
      expect(status.rows[0]?.status).toBe("pending_consent");
    }
  });
});

describe("3 · both consents activate the account", () => {
  it("records both, flips the status, and yields a real actor", async () => {
    const account = await signUp();

    const result = await activateAccountWithConsent(db, account.userId, {
      method: "signup", ipAddress: "10.0.0.9", userAgent: "vitest",
    });
    expect(result.activated).toBe(true);
    expect(result.accepted.map((a) => a.kind).sort()).toEqual(["privacy_policy", "terms_of_use"]);
    expect(result.accepted.every((a) => a.newlyRecorded)).toBe(true);

    const actor = await resolveActor(db, {
      sessionId: account.sessionId, authUserId: account.authUserId, elevatedAt: null,
    });
    expect(actor?.userId).toBe(account.userId);
  });

  it("is idempotent: accepting again records nothing new", async () => {
    const account = await signUp();
    await activateAccountWithConsent(db, account.userId, { method: "signup" });
    const again = await activateAccountWithConsent(db, account.userId, { method: "signup" });

    expect(again.accepted.every((a) => !a.newlyRecorded)).toBe(true);
    // Already active, so there was nothing left to flip.
    expect(again.activated).toBe(false);

    const records = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from consent_records where user_id = ${account.userId}::uuid
    `);
    expect(Number(records.rows[0]!.n)).toBe(2);
  });

  it("cannot revive a suspended account", async () => {
    const account = await signUp();
    await db.execute(sql`update users set status = 'suspended' where id = ${account.userId}::uuid`);

    const result = await activateAccountWithConsent(db, account.userId, { method: "signup" });
    // The consent is real and recorded; the activation is not, because the
    // update is conditional on the status still being pending_consent.
    expect(result.activated).toBe(false);
    const status = await db.execute<{ status: string }>(
      sql`select status from users where id = ${account.userId}::uuid`,
    );
    expect(status.rows[0]?.status).toBe("suspended");
  });
});

describe("4–5 · an old version does not satisfy the current one", () => {
  it("re-closes the gate when new terms of use become effective", async () => {
    const account = await signUp();
    await activateAccountWithConsent(db, account.userId, { method: "signup" });
    await expect(requireAccountConsent(db, account.userId)).resolves.toBeUndefined();

    await publishNewVersion("terms_of_use", "2026-10-01");
    await expect(requireAccountConsent(db, account.userId))
      .rejects.toBeInstanceOf(ConsentRequiredError);
  });

  it("re-closes the gate when a new privacy policy becomes effective", async () => {
    const account = await signUp();
    await activateAccountWithConsent(db, account.userId, { method: "signup" });

    await publishNewVersion("privacy_policy", "2026-10-01");
    await expect(requireAccountConsent(db, account.userId))
      .rejects.toBeInstanceOf(ConsentRequiredError);

    // Accepting the new one closes it again, and the old acceptance survives.
    await acceptCurrentVersions(db, account.userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
      method: "reaccept",
    });
    await expect(requireAccountConsent(db, account.userId)).resolves.toBeUndefined();

    const versions = await db.execute<{ version: string }>(sql`
      select v.version from consent_records c
        join legal_document_versions v on v.id = c.document_version_id
        join legal_documents d on d.id = v.document_id
       where c.user_id = ${account.userId}::uuid and d.kind = 'privacy_policy'
       order by v.version
    `);
    expect(versions.rows.map((r) => r.version)).toEqual(["0.0.0-placeholder", "2026-10-01"]);
  });
});

describe("6–7 · the client chooses neither the version nor the locale", () => {
  it("ignores a hand-recorded superseded version", async () => {
    const account = await signUp();
    const [oldTerms] = await currentVersions(db, ["terms_of_use"], { locale: "fr" });
    const [oldPrivacy] = await currentVersions(db, ["privacy_policy"], { locale: "fr" });
    await publishNewVersion("terms_of_use", "2026-10-01");
    await publishNewVersion("privacy_policy", "2026-10-01");

    // Exactly what a client that picked its own version ids could do.
    for (const version of [oldTerms!, oldPrivacy!]) {
      await recordConsent(db, {
        userId: account.userId, documentVersionId: version.versionId, method: "signup",
      });
    }

    await expect(requireAccountConsent(db, account.userId))
      .rejects.toBeInstanceOf(ConsentRequiredError);
    const status = await db.execute<{ status: string }>(
      sql`select status from users where id = ${account.userId}::uuid`,
    );
    expect(status.rows[0]?.status).toBe("pending_consent");
  });

  it("resolves the locale from the account row, so a caller cannot pick one", async () => {
    const account = await signUp();
    // The account is French. An English acceptance is a real acceptance of a
    // real document — and not of the one that binds this account.
    await acceptCurrentVersions(db, account.userId, ACCOUNT_CONSENT_KINDS, { locale: "en" }, {
      method: "signup",
    });
    await expect(requireAccountConsent(db, account.userId))
      .rejects.toBeInstanceOf(ConsentRequiredError);

    // `activateAccountWithConsent` takes no locale at all — it reads the row.
    const result = await activateAccountWithConsent(db, account.userId, { method: "signup" });
    expect(result.activated).toBe(true);
    expect(result.accepted.every((a) => a.newlyRecorded)).toBe(true);
  });
});

describe("8 · missing documents fail closed", () => {
  it("refuses to activate when a required document is not in force", async () => {
    const account = await signUp();
    await db.execute(sql`
      update legal_document_versions v
         set effective_from = now() + interval '400 days'
        from legal_documents d
       where d.id = v.document_id and d.kind = 'privacy_policy'
    `);

    await expect(activateAccountWithConsent(db, account.userId, { method: "signup" }))
      .rejects.toBeInstanceOf(ConsentUnavailableError);

    // Nothing was recorded and nothing was activated: the transaction rolled
    // back, so a half-consented account is not a state that can exist.
    const records = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from consent_records where user_id = ${account.userId}::uuid
    `);
    expect(Number(records.rows[0]!.n)).toBe(0);
    const status = await db.execute<{ status: string }>(
      sql`select status from users where id = ${account.userId}::uuid`,
    );
    expect(status.rows[0]?.status).toBe("pending_consent");
  });
});

describe("9–11 · the OTP guarantees are untouched", () => {
  it("still stores only a keyed hash, and nothing in Better Auth's table", async () => {
    const account = await signUp();
    const stored = await db.execute<{ code_hash: string }>(sql`
      select code_hash from otp_challenges where identifier = ${account.phone}
    `);
    expect(stored.rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.code_hash).not.toContain(sender.lastCodeTo(account.phone) ?? "__none__");

    const verification = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from verification where identifier = ${account.phone}
    `);
    expect(Number(verification.rows[0]!.n)).toBe(0);
  });

  it("still consumes the challenge exactly once", async () => {
    const account = await signUp();
    const consumed = await db.execute<{ consumed: boolean }>(sql`
      select consumed_at is not null as consumed from otp_challenges
       where identifier = ${account.phone}
    `);
    expect(consumed.rows[0]?.consumed).toBe(true);
  });

  it("still rate-limits issuance", async () => {
    const phone = nextPhone();
    await auth.api.sendPhoneOtp({ body: { phoneNumber: phone } });
    const refusal = await auth.api
      .sendPhoneOtp({ body: { phoneNumber: phone } })
      .then(() => undefined, (e: unknown) => e);
    expect((refusal as { statusCode?: number }).statusCode).toBe(429);
  });

  it("still refuses a wrong code", async () => {
    const phone = nextPhone();
    await auth.api.sendPhoneOtp({ body: { phoneNumber: phone } });
    const refused = await auth.api
      .verifyPhoneOtp({ body: { phoneNumber: phone, code: "000000" } })
      .then(() => undefined, (e: unknown) => e);
    expect((refused as { statusCode?: number }).statusCode).toBe(400);
    // And no account was created by a failed verification.
    const users = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from "user" where "phoneNumber" = ${phone}
    `);
    expect(Number(users.rows[0]!.n)).toBe(0);
  });
});

describe("12 · the record belongs to the right account", () => {
  it("never lets one account's acceptance activate another", async () => {
    const first = await signUp();
    const second = await signUp();
    await activateAccountWithConsent(db, first.userId, { method: "signup" });

    const state = await accountConsentStatus(db, second.userId);
    expect(state.status).toBe("pending_consent");
    expect(state.outstanding.map((o) => o.kind).sort())
      .toEqual(["privacy_policy", "terms_of_use"]);

    const actor = await resolveActor(db, {
      sessionId: second.sessionId, authUserId: second.authUserId, elevatedAt: null,
    });
    expect(actor).toBeUndefined();

    const records = await db.execute<{ user_id: string }>(sql`
      select distinct user_id::text from consent_records
    `);
    expect(records.rows.map((r) => r.user_id)).toEqual([first.userId]);
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
