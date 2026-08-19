import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto";

/**
 * One-time codes for phone-first sign-in.
 *
 * The code is stored only as a keyed hash, attempts are bounded, and codes
 * expire. Rate limiting of *issuance* is a separate concern handled by the
 * rate_limit_counters table — bounding attempts alone does not stop an attacker
 * who can request unlimited fresh codes.
 *
 * These are pure functions. Persistence lives in `otp-store.ts`, and the HTTP
 * surface in `phone-otp-plugin.ts`; nothing here knows about either.
 */
export const OTP_LENGTH = 6;

export type OtpPurpose = "sign_in" | "verify_identity" | "step_up";

/**
 * Timings and bounds an operator may need to change without a deploy.
 *
 * Review decision 7: these are configuration, not business logic. Defaults live
 * here; `loadOtpPolicy()` in `ratelimit` overlays whatever `platform_settings`
 * holds. Nothing downstream reads a literal.
 */
export interface OtpTiming {
  readonly ttlMs: number;
  readonly maxAttempts: number;
}

export const OTP_TIMING_DEFAULTS: OtpTiming = {
  ttlMs: 5 * 60 * 1000,
  maxAttempts: 5,
};

export interface GeneratedOtp {
  readonly code: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
}

/** Cryptographically uniform, unlike Math.random-based digit pickers. */
export function generateOtpCode(length: number = OTP_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
  return code;
}

/**
 * Derives the OTP hashing key from the application secret.
 *
 * A six-digit code has about 20 bits of entropy, so a plain digest of it — even
 * salted with the phone number — is reversible by trying all 1 000 000 inputs,
 * which takes milliseconds. Only a key the database does not contain makes a
 * stolen `otp_challenges` table useless on its own. HKDF gives that key its own
 * domain so it is never the same bytes as the session secret, and rotating the
 * secret only invalidates codes with five minutes left to live.
 */
export function deriveOtpKey(appSecret: string): Buffer {
  if (appSecret === "") {
    throw new Error("An application secret is required to derive the OTP key.");
  }
  return Buffer.from(hkdfSync("sha256", appSecret, "", "afrinext:otp:v1", 32));
}

/**
 * Keyed with the derived key, and bound to the identifier and purpose so a code
 * issued for one phone or one purpose cannot be replayed against another.
 */
export function hashOtpCode(
  code: string,
  identifier: string,
  purpose: OtpPurpose,
  key: Buffer,
): string {
  return createHmac("sha256", key).update(`${purpose}:${identifier}:${code}`).digest("hex");
}

export function generateOtp(
  identifier: string,
  purpose: OtpPurpose,
  key: Buffer,
  timing: OtpTiming = OTP_TIMING_DEFAULTS,
  now = Date.now(),
): GeneratedOtp {
  const code = generateOtpCode();
  return {
    code,
    codeHash: hashOtpCode(code, identifier, purpose, key),
    expiresAt: new Date(now + timing.ttlMs),
  };
}

export interface OtpChallengeState {
  readonly codeHash: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export type OtpFailure = "expired" | "consumed" | "too_many_attempts" | "mismatch";

export type OtpVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: OtpFailure };

export function verifyOtp(
  challenge: OtpChallengeState,
  code: string,
  identifier: string,
  purpose: OtpPurpose,
  key: Buffer,
  now = new Date(),
): OtpVerdict {
  if (challenge.consumedAt !== null) return { ok: false, reason: "consumed" };
  if (challenge.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (challenge.attempts > challenge.maxAttempts) return { ok: false, reason: "too_many_attempts" };

  const candidate = Buffer.from(hashOtpCode(code, identifier, purpose, key), "hex");
  const expected = Buffer.from(challenge.codeHash, "hex");
  const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  return matches ? { ok: true } : { ok: false, reason: "mismatch" };
}
