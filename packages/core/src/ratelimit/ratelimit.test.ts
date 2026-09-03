import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import { ensureReferenceData, resetData, testDb } from "../test/harness";
import { consume, consumeAll, otpSendRules, peek, pruneExpired, stepUpSendRules, OTP_POLICY } from "./index";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

describe("fixed-window rate limiting", () => {
  it("allows up to the limit and refuses beyond it", async () => {
    const rule = { bucket: "test:a", limit: 3, windowMs: 60_000 };
    const verdicts = [];
    for (let i = 0; i < 5; i += 1) verdicts.push(await consume(db, rule));

    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true, false, false]);
    expect(verdicts[3]?.retryAfterMs).toBeGreaterThan(0);
  });

  it("counts refused attempts too, so hammering does not drain the window early", async () => {
    const rule = { bucket: "test:b", limit: 2, windowMs: 60_000 };
    const at = 1_700_000_000_000;
    for (let i = 0; i < 6; i += 1) await consume(db, rule, at);
    expect(await peek(db, rule, at)).toBe(6);
  });

  it("starts a fresh window when the clock moves on", async () => {
    const rule = { bucket: "test:c", limit: 2, windowMs: 60_000 };
    const t0 = 1_700_000_000_000;
    expect((await consume(db, rule, t0)).allowed).toBe(true);
    expect((await consume(db, rule, t0)).allowed).toBe(true);
    expect((await consume(db, rule, t0)).allowed).toBe(false);
    // Next window.
    expect((await consume(db, rule, t0 + 60_000)).allowed).toBe(true);
  });

  it("keeps separate buckets separate", async () => {
    const a = { bucket: "test:phone:+227A", limit: 1, windowMs: 60_000 };
    const b = { bucket: "test:phone:+227B", limit: 1, windowMs: 60_000 };
    expect((await consume(db, a)).allowed).toBe(true);
    expect((await consume(db, b)).allowed).toBe(true);
    expect((await consume(db, a)).allowed).toBe(false);
  });

  it("does not lose counts when hit concurrently", async () => {
    // A limiter that loses increments under load is not a limiter. This is the
    // case a naive read-then-write implementation gets wrong.
    const rule = { bucket: "test:parallel", limit: 1000, windowMs: 60_000 };
    // Pin the clock: consume() and peek() each call Date.now() otherwise, and a
    // window boundary crossing mid-test would look like a lost count.
    const at = 1_700_000_000_000;
    await Promise.all(Array.from({ length: 50 }, () => consume(db, rule, at)));
    expect(await peek(db, rule, at)).toBe(50);
  });

  it("refuses beyond the limit even when the burst is concurrent", async () => {
    const rule = { bucket: "test:burst", limit: 5, windowMs: 60_000 };
    const at = 1_700_000_000_000;
    const verdicts = await Promise.all(Array.from({ length: 20 }, () => consume(db, rule, at)));
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(5);
  });

  it("stops at the first refusal in a rule set", async () => {
    const rules = [
      { bucket: "test:first", limit: 0, windowMs: 60_000 },
      { bucket: "test:second", limit: 10, windowMs: 60_000 },
    ];
    const verdict = await consumeAll(db, rules);
    expect(verdict.allowed).toBe(false);
    // The second rule must not have been charged for a request that was refused.
    expect(await peek(db, rules[1]!)).toBe(0);
  });

  it("prunes windows that can no longer be current", async () => {
    await db.execute(sql`
      insert into rate_limit_counters (bucket, window_start, count)
      values ('old', now() - interval '3 days', 5)
    `);
    const removed = await pruneExpired(db);
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});

describe("OTP issuance policy", () => {
  it("limits sends per identifier, per IP, and enforces a cooldown", async () => {
    const rules = otpSendRules("+22790000001", "196.200.0.1");
    const buckets = rules.map((r) => r.bucket);
    expect(buckets).toContain("otp:send:id:+22790000001");
    expect(buckets).toContain("otp:cooldown:id:+22790000001");
    expect(buckets).toContain("otp:send:ip:196.200.0.1");
  });

  it("blocks a second code inside the cooldown", async () => {
    const first = await consumeAll(db, otpSendRules("+22790000002", undefined));
    expect(first.allowed).toBe(true);
    // Every SMS costs money; back-to-back sends are the cheapest abuse there is.
    const second = await consumeAll(db, otpSendRules("+22790000002", undefined));
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
  });

  it("stops an identifier after the hourly allowance, across the whole hour", async () => {
    const phone = "+22790000003";
    let allowed = 0;
    // Step the clock past the cooldown each time so only the hourly rule binds.
    for (let i = 0; i < OTP_POLICY.perPhonePerHour + 3; i += 1) {
      const at = 1_700_000_000_000 + i * (OTP_POLICY.cooldownMs + 1_000);
      if ((await consumeAll(db, otpSendRules(phone, undefined), at)).allowed) allowed += 1;
    }
    expect(allowed).toBe(OTP_POLICY.perPhonePerHour);
  });

  it("limits a shared IP independently of the phone", async () => {
    const ip = "196.200.0.9";
    let allowed = 0;
    for (let i = 0; i < OTP_POLICY.perIpPerHour + 5; i += 1) {
      const at = 1_700_000_000_000 + i * (OTP_POLICY.cooldownMs + 1_000);
      // A different phone each time, so only the IP rule can bind.
      if ((await consumeAll(db, otpSendRules(`+2279000${1000 + i}`, ip), at)).allowed) allowed += 1;
    }
    expect(allowed).toBe(OTP_POLICY.perIpPerHour);
  });

  it("limits step-up challenges harder than sign-in codes", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    let allowed = 0;
    for (let i = 0; i < 6; i += 1) {
      const at = 1_700_000_000_000 + i * (OTP_POLICY.cooldownMs + 1_000);
      if ((await consumeAll(db, stepUpSendRules(userId), at)).allowed) allowed += 1;
    }
    // Elevation guards payouts; it is deliberately stricter than sign-in.
    expect(allowed).toBe(3);
    expect(allowed).toBeLessThan(OTP_POLICY.perPhonePerHour);
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
