import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";

/**
 * Fixed-window rate limiting, counted in PostgreSQL.
 *
 * Bounding *verification attempts* alone does not protect anything: an attacker
 * who can request unlimited fresh codes gets unlimited attempts, and every SMS
 * costs real money. Issuance is therefore limited too, per identifier and per
 * IP, with a cooldown between consecutive sends.
 *
 * The counter is incremented with a single atomic statement so two concurrent
 * requests cannot both read "4 used" and both proceed.
 */
export interface RateLimitRule {
  /** Stable key, e.g. `otp:send:phone:+22790000001`. */
  readonly bucket: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number;
  readonly retryAfterMs: number;
}

function windowStart(windowMs: number, now: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Counts one use against a rule and reports whether it is allowed.
 *
 * The row is inserted-or-incremented atomically, then compared. A request that
 * exceeds the limit is still counted — that is deliberate, so hammering a
 * blocked bucket does not let it drain early.
 */
export async function consume(
  db: Database,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<RateLimitVerdict> {
  const start = windowStart(rule.windowMs, now);
  const rows = await db.execute<{ count: number | string }>(sql`
    insert into rate_limit_counters (bucket, window_start, count)
    values (${rule.bucket}, ${start.toISOString()}, 1)
    on conflict (bucket, window_start)
      do update set count = rate_limit_counters.count + 1
    returning count
  `);

  const used = Number(rows.rows[0]?.count ?? 1);
  const resetAt = start.getTime() + rule.windowMs;
  return {
    allowed: used <= rule.limit,
    used,
    limit: rule.limit,
    retryAfterMs: used <= rule.limit ? 0 : Math.max(0, resetAt - now),
  };
}

/** Reads a bucket without counting against it. */
export async function peek(
  db: Database,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<number> {
  const start = windowStart(rule.windowMs, now);
  const rows = await db.execute<{ count: number | string }>(sql`
    select count from rate_limit_counters
     where bucket = ${rule.bucket} and window_start = ${start.toISOString()}
  `);
  return Number(rows.rows[0]?.count ?? 0);
}

/** Applies several rules; the first refusal wins and the rest are not counted. */
export async function consumeAll(
  db: Database,
  rules: readonly RateLimitRule[],
  now: number = Date.now(),
): Promise<RateLimitVerdict> {
  let worst: RateLimitVerdict | undefined;
  for (const rule of rules) {
    const verdict = await consume(db, rule, now);
    if (!verdict.allowed) return verdict;
    if (worst === undefined || verdict.used / verdict.limit > worst.used / worst.limit) {
      worst = verdict;
    }
  }
  return worst ?? { allowed: true, used: 0, limit: 0, retryAfterMs: 0 };
}

/** Removes windows that can no longer be current. Run periodically. */
export async function pruneExpired(db: Database, olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = await db.execute(
    sql`delete from rate_limit_counters where window_start < ${cutoff}`,
  );
  return result.rowCount ?? 0;
}

/**
 * OTP issuance policy.
 *
 * Deliberately tight: each send costs money, and a phone-first market makes SMS
 * the main abuse surface.
 *
 * Review decision 7 approved these numbers *for now* and required that they
 * stay configuration rather than literals buried in business logic. So this is
 * a default, `loadOtpPolicy()` overlays whatever `platform_settings` holds, and
 * every caller takes the policy as an argument. Changing a limit is an UPDATE,
 * not a deploy.
 *
 * The per-IP limit is the production-tuning point to watch: carrier NAT and
 * shared connections are the norm in Niger, so 20 per hour may prove too tight
 * for a whole neighbourhood behind one address. It is the first number to
 * revisit against real traffic.
 */
export interface OtpPolicy {
  readonly perPhonePerHour: number;
  readonly perIpPerHour: number;
  readonly cooldownMs: number;
  readonly verificationAttempts: number;
  readonly ttlMs: number;
  readonly stepUpPerHour: number;
}

export const OTP_POLICY: OtpPolicy = {
  perPhonePerHour: 5,
  perIpPerHour: 20,
  cooldownMs: 60_000,
  verificationAttempts: 5,
  ttlMs: 5 * 60 * 1000,
  stepUpPerHour: 3,
};

/** The `platform_settings` key the overlay is read from. */
export const OTP_POLICY_SETTING_KEY = "auth.otp_policy";

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Reads the policy, falling back field by field.
 *
 * A malformed or partial settings row must never be able to *widen* a limit by
 * accident, so each field is validated on its own and anything that is not a
 * positive integer falls back to the default rather than to zero or Infinity.
 */
export async function loadOtpPolicy(db: Database): Promise<OtpPolicy> {
  const rows = await db.execute<{ value: Record<string, unknown> | null }>(sql`
    select value from platform_settings where key = ${OTP_POLICY_SETTING_KEY}
  `);
  const stored = rows.rows[0]?.value;
  if (stored === null || stored === undefined || typeof stored !== "object") return OTP_POLICY;
  return {
    perPhonePerHour: positiveInt(stored["perPhonePerHour"], OTP_POLICY.perPhonePerHour),
    perIpPerHour: positiveInt(stored["perIpPerHour"], OTP_POLICY.perIpPerHour),
    cooldownMs: positiveInt(stored["cooldownMs"], OTP_POLICY.cooldownMs),
    verificationAttempts: positiveInt(stored["verificationAttempts"], OTP_POLICY.verificationAttempts),
    ttlMs: positiveInt(stored["ttlMs"], OTP_POLICY.ttlMs),
    stepUpPerHour: positiveInt(stored["stepUpPerHour"], OTP_POLICY.stepUpPerHour),
  };
}

export function otpSendRules(
  identifier: string,
  ipAddress: string | undefined,
  policy: OtpPolicy = OTP_POLICY,
): RateLimitRule[] {
  const rules: RateLimitRule[] = [
    { bucket: `otp:send:id:${identifier}`, limit: policy.perPhonePerHour, windowMs: 3_600_000 },
    // The cooldown is a one-per-window rule on a short window.
    { bucket: `otp:cooldown:id:${identifier}`, limit: 1, windowMs: policy.cooldownMs },
  ];
  if (ipAddress !== undefined && ipAddress !== "") {
    rules.push({ bucket: `otp:send:ip:${ipAddress}`, limit: policy.perIpPerHour, windowMs: 3_600_000 });
  }
  return rules;
}

/** Purpose-specific: elevation challenges are rarer and limited harder. */
export function stepUpSendRules(userId: string, policy: OtpPolicy = OTP_POLICY): RateLimitRule[] {
  return [
    { bucket: `stepup:send:user:${userId}`, limit: policy.stepUpPerHour, windowMs: 3_600_000 },
    { bucket: `stepup:cooldown:user:${userId}`, limit: 1, windowMs: policy.cooldownMs },
  ];
}
