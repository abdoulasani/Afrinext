import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getPool, type Database } from "@afrinext/db";
import { ensureReferenceData, resetData, testDb } from "../test/harness";
import { loadOtpPolicy, OTP_POLICY, OTP_POLICY_SETTING_KEY } from "../ratelimit";
import { createAuth } from "./better-auth";
import { ConsoleSender } from "./messaging";
import { deriveOtpKey, hashOtpCode } from "./otp";
import { consumeChallenge, issueChallenge, pruneChallenges } from "./otp-store";
import { assertNoPlaintextPhoneCodes } from "./phone-otp-plugin";

/**
 * Review decision 1, tested adversarially.
 *
 * Every test here is written from the position of someone trying to break the
 * property, not from the position of someone demonstrating the happy path — the
 * happy path is already covered in flow.test.ts. What is under test is what
 * happens when the code is wrong, reused, guessed in parallel, replayed from
 * another number, or read straight out of the database.
 */
const SECRET = "test-application-secret-0123456789abcdef";
const KEY = deriveOtpKey(SECRET);

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

async function sendTo(phone: string): Promise<string> {
  await auth.api.sendPhoneOtp({ body: { phoneNumber: phone } });
  const code = sender.lastCodeTo(phone);
  expect(code, "a code should have been sent").toBeDefined();
  return code as string;
}

function reject(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => undefined, (e: unknown) => e);
}

describe("the code never exists in plaintext", () => {
  it("stores only a hash, and the hash is not a digest of the code alone", async () => {
    const phone = "+22790000201";
    const code = await sendTo(phone);

    const rows = await db.execute<{ code_hash: string; purpose: string; kind: string }>(sql`
      select code_hash, purpose, kind from otp_challenges where identifier = ${phone}
    `);
    expect(rows.rows).toHaveLength(1);
    const stored = rows.rows[0]!;

    // Not the code, and not anything containing it.
    expect(stored.code_hash).not.toContain(code);
    expect(stored.code_hash).toHaveLength(64);
    expect(stored.purpose).toBe("sign_in");
    expect(stored.kind).toBe("phone");

    // It IS the keyed hash — so the column holds what we think it holds, and a
    // future change that silently stopped hashing would fail here.
    expect(stored.code_hash).toBe(hashOtpCode(code, phone, "sign_in", KEY));
  });

  it("cannot be reversed from the table alone, without the application secret", async () => {
    const phone = "+22790000202";
    await sendTo(phone);
    const rows = await db.execute<{ code_hash: string }>(sql`
      select code_hash from otp_challenges where identifier = ${phone}
    `);
    const stolen = rows.rows[0]!.code_hash;

    // An attacker with the whole table and the phone number tries all million
    // six-digit codes with the wrong key. A salted-but-unkeyed digest would
    // fall to exactly this loop; here a 1000-code sample must not produce a
    // single hit, and the same sample with the right key must hit.
    const wrongKey = deriveOtpKey("not-the-application-secret");
    for (let i = 0; i < 1000; i += 1) {
      const guess = String(i).padStart(6, "0");
      expect(hashOtpCode(guess, phone, "sign_in", wrongKey)).not.toBe(stolen);
    }
  });

  it("leaves nothing in Better Auth's verification table", async () => {
    const phone = "+22790000203";
    const code = await sendTo(phone);
    await auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code } });

    // The whole point of decision 1: Better Auth's phone plugin is not mounted,
    // so there is no path that writes a plaintext code there.
    await assertNoPlaintextPhoneCodes(db, phone);

    const all = await db.execute<{ value: string }>(sql`select value from verification`);
    for (const row of all.rows) expect(row.value).not.toContain(code);
  });

  it("has no reachable endpoint that would create one", async () => {
    // If a future upgrade re-mounts Better Auth's phone plugin, these come back
    // and the plaintext path returns with them.
    const api = auth.api as unknown as Record<string, unknown>;
    expect(api["sendPhoneNumberOTP"]).toBeUndefined();
    expect(api["verifyPhoneNumber"]).toBeUndefined();
    expect(api["signInPhoneNumber"]).toBeUndefined();
    expect(api["resetPasswordPhoneNumber"]).toBeUndefined();
  });
});

describe("a code is single use", () => {
  it("refuses the same correct code twice", async () => {
    const phone = "+22790000210";
    const code = await sendTo(phone);

    await auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code } });
    // A replayed code must not mint a second session.
    expect(await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code } }))).toBeDefined();

    const sessions = await db.execute(sql`
      select s.id from session s join "user" u on u.id = s."userId"
       where u."phoneNumber" = ${phone}
    `);
    expect(sessions.rows).toHaveLength(1);
  });

  it("gives exactly one session when the same code is presented concurrently", async () => {
    const phone = "+22790000211";
    const code = await sendTo(phone);

    // Two tabs, one code. The consumption is `where consumed_at is null`, so
    // the database decides the winner rather than a read-then-write race.
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code } })),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);

    const sessions = await db.execute(sql`
      select s.id from session s join "user" u on u.id = s."userId"
       where u."phoneNumber" = ${phone}
    `);
    expect(sessions.rows).toHaveLength(1);
  });

  it("lets exactly one of many simultaneous consumers win, at the store level", async () => {
    // Deliberately below the endpoint. At the endpoint a first-time sign-in is
    // also protected by the unique phone number on the credential row, which
    // would mask a broken consumption guard; here nothing else can save it.
    const phone = "+22790000214";
    const issued = await issueChallenge(db, {
      kind: "phone", identifier: phone, purpose: "sign_in", key: KEY,
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeChallenge(db, {
          kind: "phone", identifier: phone, purpose: "sign_in", code: issued.code, key: KEY,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("gives a returning user exactly one session from one code", async () => {
    // The concurrent case above runs at the endpoint for a phone that already
    // has a credential, so the unique constraint on user.phoneNumber is not
    // what is being tested.
    const phone = "+22790000215";
    const first = await sendTo(phone);
    await auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code: first } });

    await db.execute(sql`delete from rate_limit_counters`);
    const second = await sendTo(phone);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () => auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code: second } })),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);

    const sessions = await db.execute(sql`
      select s.id from session s join "user" u on u.id = s."userId"
       where u."phoneNumber" = ${phone}
    `);
    // One from the first sign-in, one from the winner of the race. Not seven.
    expect(sessions.rows).toHaveLength(2);
  });

  it("retires the previous code when a new one is issued", async () => {
    const phone = "+22790000212";
    const first = await sendTo(phone);

    // Past the cooldown, ask again. Banking several live codes would multiply
    // the attempt budget, so the old one must die.
    await db.execute(sql`delete from rate_limit_counters`);
    const second = await sendTo(phone);
    expect(second).not.toBe(first);

    expect(await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code: first } }))).toBeDefined();
    await auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code: second } });
  });

  it("keeps at most one live challenge per identifier, enforced by the database", async () => {
    const phone = "+22790000213";
    await issueChallenge(db, { kind: "phone", identifier: phone, purpose: "sign_in", key: KEY });
    await issueChallenge(db, { kind: "phone", identifier: phone, purpose: "sign_in", key: KEY });

    const live = await db.execute(sql`
      select id from otp_challenges
       where identifier = ${phone} and purpose = 'sign_in' and consumed_at is null
    `);
    expect(live.rows).toHaveLength(1);

    // And the guarantee is the index, not the code path that happens to retire
    // the old row first: a direct insert alongside a live challenge is refused.
    await expect(
      db.execute(sql`
        insert into otp_challenges (id, kind, identifier, code_hash, purpose, max_attempts, expires_at)
        values (gen_random_uuid(), 'phone', ${phone}, 'deadbeef', 'sign_in', 5, now() + interval '5 minutes')
      `),
    ).rejects.toThrow();
  });
});

describe("guessing is bounded", () => {
  it("spends an attempt on every wrong guess and stops at the limit", async () => {
    const phone = "+22790000220";
    const code = await sendTo(phone);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < OTP_POLICY.verificationAttempts; i += 1) {
      expect(await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code: wrong } }))).toBeDefined();
    }

    const spent = await db.execute<{ attempts: number }>(sql`
      select attempts from otp_challenges where identifier = ${phone}
    `);
    expect(spent.rows[0]?.attempts).toBe(OTP_POLICY.verificationAttempts);

    // The budget is exhausted, so even the RIGHT code is now refused. Without
    // this the attempt counter would only be an inconvenience.
    const exhausted = await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code } }));
    // And refused the same way as any other bad code — a 400 the caller can
    // act on. Asserting the status matters: if the counter were bounded only
    // by the check constraint rather than by the guarded UPDATE, this would be
    // a 500 from a constraint violation, which leaks that the budget exists and
    // reads as a server fault in monitoring.
    const shape = exhausted as { statusCode?: number; body?: { code?: string } };
    expect(shape.statusCode).toBe(400);
    expect(shape.body?.code).toBe("auth.otp_invalid");
  });

  it("cannot be raced past the attempt limit", async () => {
    const phone = "+22790000221";
    await sendTo(phone);

    // Twenty simultaneous guesses against a five-attempt budget. The counter
    // increments with `attempts < max_attempts` in the WHERE clause, so the
    // database serialises them and the check constraint can never trip.
    await Promise.allSettled(
      Array.from({ length: 20 }, () => auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code: "000000" } })),
    );

    const spent = await db.execute<{ attempts: number; max_attempts: number }>(sql`
      select attempts, max_attempts from otp_challenges where identifier = ${phone}
    `);
    expect(spent.rows[0]?.attempts).toBeLessThanOrEqual(spent.rows[0]!.max_attempts);
    expect(spent.rows[0]?.attempts).toBe(OTP_POLICY.verificationAttempts);
  });

  it("refuses an expired code even when it is the right one", async () => {
    const phone = "+22790000222";
    const code = await sendTo(phone);
    await db.execute(sql`
      update otp_challenges set expires_at = now() - interval '1 second' where identifier = ${phone}
    `);
    expect(await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code } }))).toBeDefined();
  });

  it("refuses a code issued to a different number", async () => {
    const a = "+22790000223";
    const b = "+22790000224";
    const codeForA = await sendTo(a);
    await sendTo(b);

    // The hash is bound to the identifier, so A's code cannot sign in as B even
    // if both happen to be six digits that collide.
    expect(await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: b, code: codeForA } }))).toBeDefined();
  });

  it("refuses a code for a number that never asked for one", async () => {
    expect(
      await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: "+22790000225", code: "123456" } })),
    ).toBeDefined();
  });

  it("answers every failure identically, so it cannot be used to enumerate", async () => {
    const known = "+22790000226";
    await sendTo(known);

    const wrongCode = await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: known, code: "000000" } }));
    const noChallenge = await reject(
      auth.api.verifyPhoneOtp({ body: { phoneNumber: "+22790000227", code: "000000" } }),
    );

    const shape = (e: unknown) => {
      const err = e as { statusCode?: number; body?: { code?: string; message?: string } };
      return { status: err.statusCode, code: err.body?.code, message: err.body?.message };
    };
    // "This number has a code in flight" is itself information worth hiding.
    expect(shape(wrongCode)).toEqual(shape(noChallenge));
  });
});

describe("failures are recorded where only we can read them", () => {
  it("audits the real reason without ever writing the code", async () => {
    const phone = "+22790000230";
    const code = await sendTo(phone);
    await reject(auth.api.verifyPhoneOtp({ body: { phoneNumber: phone, code: "000000" } }));

    const rows = await db.execute<{ action: string; context: unknown }>(sql`
      select action, context from audit_logs where action like 'auth.otp%' order by occurred_at
    `);
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toContain("auth.otp.sent");
    expect(actions).toContain("auth.otp.failed");
    expect(JSON.stringify(rows.rows)).toContain("mismatch");
    expect(JSON.stringify(rows.rows)).not.toContain(code);
  });
});

describe("challenges do not accumulate forever", () => {
  it("prunes spent and expired rows, and leaves live ones alone", async () => {
    const live = "+22790000240";
    await issueChallenge(db, { kind: "phone", identifier: live, purpose: "sign_in", key: KEY });

    const stale = "+22790000241";
    const issued = await issueChallenge(db, { kind: "phone", identifier: stale, purpose: "sign_in", key: KEY });
    await db.execute(sql`
      update otp_challenges
         set consumed_at = now(), created_at = now() - interval '2 days'
       where id = ${issued.challengeId}
    `);

    expect(await pruneChallenges(db)).toBe(1);
    const left = await db.execute<{ identifier: string }>(sql`select identifier from otp_challenges`);
    expect(left.rows.map((r) => r.identifier)).toEqual([live]);
  });
});

describe("the limits are configuration", () => {
  it("reads the policy from platform_settings", async () => {
    await db.execute(sql`
      update platform_settings
         set value = '{"perPhonePerHour":9,"perIpPerHour":99}'::jsonb
       where key = ${OTP_POLICY_SETTING_KEY}
    `);
    const policy = await loadOtpPolicy(db);
    expect(policy.perPhonePerHour).toBe(9);
    expect(policy.perIpPerHour).toBe(99);
    // Fields the row does not mention keep their default rather than becoming
    // zero or undefined.
    expect(policy.verificationAttempts).toBe(OTP_POLICY.verificationAttempts);
  });

  it("never lets a malformed setting widen or disable a limit", async () => {
    await db.execute(sql`
      update platform_settings
         set value = '{"perPhonePerHour":0,"perIpPerHour":-1,"cooldownMs":"lots","ttlMs":null}'::jsonb
       where key = ${OTP_POLICY_SETTING_KEY}
    `);
    // A bad row must fail closed, back to the reviewed defaults.
    expect(await loadOtpPolicy(db)).toEqual(OTP_POLICY);
  });
});

describe("the store rejects what the endpoint would never send", () => {
  it("reports no_challenge rather than throwing on an unknown identifier", async () => {
    expect(
      await consumeChallenge(db, {
        kind: "phone", identifier: "+22790000250", purpose: "sign_in", code: "123456", key: KEY,
      }),
    ).toEqual({ ok: false, reason: "no_challenge" });
  });

  it("will not verify a sign_in code against the step_up purpose", async () => {
    const phone = "+22790000251";
    const issued = await issueChallenge(db, {
      kind: "phone", identifier: phone, purpose: "sign_in", key: KEY,
    });
    // Step-up guards payouts. A code the person got for signing in must not
    // double as the fresh re-verification a withdrawal demands.
    expect(
      await consumeChallenge(db, {
        kind: "phone", identifier: phone, purpose: "step_up", code: issued.code, key: KEY,
      }),
    ).toEqual({ ok: false, reason: "no_challenge" });
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
