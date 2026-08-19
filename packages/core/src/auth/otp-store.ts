import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { uuidv7 } from "../ids";
import {
  generateOtp, verifyOtp,
  type OtpFailure, type OtpPurpose, type OtpTiming, OTP_TIMING_DEFAULTS,
} from "./otp";

/**
 * The `otp_challenges` table is the only place a verification code exists.
 *
 * Review decision 1 rejected letting Better Auth hold phone codes: it writes
 * them to `verification.value` in the clear, so a single table read is an
 * account takeover for everyone with a code in flight. Here the row holds a
 * keyed hash and nothing else, and both the attempt counter and the single-use
 * consumption are enforced by the database rather than by a read-then-write
 * this code hopes nobody interleaves.
 */
export interface IssuedChallenge {
  readonly challengeId: string;
  readonly code: string;
  readonly expiresAt: Date;
}

export interface IssueInput {
  readonly kind: "phone" | "email";
  readonly identifier: string;
  readonly purpose: OtpPurpose;
  readonly key: Buffer;
  readonly ipAddress?: string | undefined;
  readonly timing?: OtpTiming | undefined;
}

/**
 * Issues a code, retiring any that are still live for the same identifier.
 *
 * Without that retirement a caller could bank several usable codes and then
 * spend the whole attempt budget of each. One identifier, one live code.
 */
export async function issueChallenge(
  db: Database,
  input: IssueInput,
): Promise<IssuedChallenge> {
  const timing = input.timing ?? OTP_TIMING_DEFAULTS;
  const otp = generateOtp(input.identifier, input.purpose, input.key, timing);
  const challengeId = uuidv7();

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update otp_challenges set consumed_at = now()
       where kind = ${input.kind}
         and identifier = ${input.identifier}
         and purpose = ${input.purpose}
         and consumed_at is null
    `);
    await tx.execute(sql`
      insert into otp_challenges
        (id, kind, identifier, code_hash, purpose, attempts, max_attempts, expires_at, requested_by_ip)
      values (${challengeId}, ${input.kind}, ${input.identifier}, ${otp.codeHash},
              ${input.purpose}, 0, ${timing.maxAttempts},
              ${otp.expiresAt.toISOString()}, ${input.ipAddress ?? null}::inet)
    `);
  });

  return { challengeId, code: otp.code, expiresAt: otp.expiresAt };
}

export type ConsumeResult =
  | { readonly ok: true; readonly challengeId: string }
  | { readonly ok: false; readonly reason: OtpFailure | "no_challenge" };

interface ChallengeRow {
  [key: string]: unknown;
  id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

/**
 * Checks a code and, if it is right, consumes the challenge — once.
 *
 * Three things are deliberately done in SQL rather than in TypeScript:
 *
 *  - the attempt counter increments with `attempts < max_attempts` in the WHERE
 *    clause, so two simultaneous guesses cannot both read "4 used" and both
 *    proceed, and the `otp_attempts_bounded` check constraint can never trip;
 *  - a wrong guess still costs an attempt, so guessing is bounded even when it
 *    never lands;
 *  - consumption is `where consumed_at is null`, so if two requests present the
 *    correct code at the same instant exactly one of them gets a session.
 */
export async function consumeChallenge(
  db: Database,
  input: {
    readonly kind: "phone" | "email";
    readonly identifier: string;
    readonly purpose: OtpPurpose;
    readonly code: string;
    readonly key: Buffer;
  },
): Promise<ConsumeResult> {
  const found = await db.execute<ChallengeRow>(sql`
    select id, code_hash, attempts, max_attempts, expires_at, consumed_at
      from otp_challenges
     where kind = ${input.kind}
       and identifier = ${input.identifier}
       and purpose = ${input.purpose}
       and consumed_at is null
     order by created_at desc
     limit 1
  `);
  const row = found.rows[0];
  if (row === undefined) return { ok: false, reason: "no_challenge" };

  const spent = await db.execute<ChallengeRow>(sql`
    update otp_challenges
       set attempts = attempts + 1
     where id = ${row.id}
       and consumed_at is null
       and attempts < max_attempts
    returning id, code_hash, attempts, max_attempts, expires_at, consumed_at
  `);
  const after = spent.rows[0];
  if (after === undefined) return { ok: false, reason: "too_many_attempts" };

  const verdict = verifyOtp(
    {
      codeHash: after.code_hash,
      attempts: after.attempts,
      maxAttempts: after.max_attempts,
      expiresAt: new Date(after.expires_at),
      consumedAt: after.consumed_at === null ? null : new Date(after.consumed_at),
    },
    input.code,
    input.identifier,
    input.purpose,
    input.key,
  );
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const consumed = await db.execute(sql`
    update otp_challenges set consumed_at = now()
     where id = ${row.id} and consumed_at is null
    returning id
  `);
  if (consumed.rows.length === 0) return { ok: false, reason: "consumed" };

  return { ok: true, challengeId: row.id };
}

/**
 * Removes challenges that can no longer be used.
 *
 * Expired and consumed rows carry no live secret, but they do carry a record of
 * who asked for a code and when. Keeping them forever turns an OTP table into a
 * contact-and-activity log nobody asked for.
 */
export async function pruneChallenges(db: Database, olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = await db.execute(sql`
    delete from otp_challenges
     where (consumed_at is not null or expires_at < now())
       and created_at < ${cutoff}
    returning id
  `);
  return result.rows.length;
}
