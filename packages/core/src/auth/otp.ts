import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * One-time codes for phone-first sign-in.
 *
 * The code is stored only as a salted hash, attempts are bounded, and codes
 * expire. Rate limiting of *issuance* is a separate concern handled by the
 * rate_limit_counters table — bounding attempts alone does not stop an attacker
 * who can request unlimited fresh codes.
 */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** Per identifier, per window. Deliberately low: each send costs money. */
export const OTP_MAX_SENDS_PER_HOUR = 5;

export type OtpPurpose = "sign_in" | "verify_identity" | "step_up";

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
 * Hashed with the identifier as a salt so the same code issued to two people
 * does not produce the same hash, and a stolen table cannot be reversed with a
 * single rainbow table of a million six-digit strings.
 */
export function hashOtpCode(code: string, identifier: string, purpose: OtpPurpose): string {
  return createHash("sha256").update(`${purpose}:${identifier}:${code}`).digest("hex");
}

export function generateOtp(
  identifier: string,
  purpose: OtpPurpose,
  now = Date.now(),
): GeneratedOtp {
  const code = generateOtpCode();
  return {
    code,
    codeHash: hashOtpCode(code, identifier, purpose),
    expiresAt: new Date(now + OTP_TTL_MS),
  };
}

export interface OtpChallengeState {
  readonly codeHash: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export type OtpVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "expired" | "consumed" | "too_many_attempts" | "mismatch" };

export function verifyOtp(
  challenge: OtpChallengeState,
  code: string,
  identifier: string,
  purpose: OtpPurpose,
  now = new Date(),
): OtpVerdict {
  if (challenge.consumedAt !== null) return { ok: false, reason: "consumed" };
  if (challenge.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: "too_many_attempts" };

  const candidate = Buffer.from(hashOtpCode(code, identifier, purpose), "hex");
  const expected = Buffer.from(challenge.codeHash, "hex");
  const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  return matches ? { ok: true } : { ok: false, reason: "mismatch" };
}
