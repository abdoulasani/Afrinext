import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";

/**
 * Retry policy, read from `platform_settings` and CLAMPED so configuration can
 * only ever make refunds LESS aggressive.
 *
 * The asymmetry is deliberate and it is the same argument the late-payment
 * grace window makes. Retrying a refund is the operation with a duplicate on
 * the other side of it, so the reviewed numbers are ceilings on aggression, not
 * defaults an operator may raise with an UPDATE. Narrowing needs nobody's
 * permission; widening is a policy change and needs the review that produced
 * the number.
 *
 * Two directions of "more aggressive", both closed:
 *
 *   counts    clamped DOWNWARD — at most the reviewed maximum of attempts;
 *   waits     clamped UPWARD   — at least the reviewed minimum of seconds.
 *
 * A malformed row — a string, a negative, NaN, null, a missing key — is not an
 * instruction. Every loader falls back to the reviewed value rather than to
 * "no limit", because a broken setting must never open a gate.
 */

export const REFUND_MAX_ATTEMPTS_KEY = "refund.max_attempts";
export const REFUND_RETRY_BACKOFF_KEY = "refund.retry_backoff_seconds";
export const REFUND_STUCK_IN_FLIGHT_KEY = "refund.stuck_in_flight_seconds";
export const REFUND_QUEUE_BATCH_KEY = "refund.queue_batch_size";

/** At most three provider attempts for one refund, ever. */
export const DEFAULT_REFUND_MAX_ATTEMPTS = 3;
/** At least five minutes between attempts. */
export const DEFAULT_REFUND_RETRY_BACKOFF_SECONDS = 300;
/** At least fifteen minutes before an unanswered request is called unknown. */
export const DEFAULT_REFUND_STUCK_IN_FLIGHT_SECONDS = 900;
/** At most twenty refunds per scheduler invocation. */
export const DEFAULT_REFUND_QUEUE_BATCH_SIZE = 20;

export interface RefundPolicy {
  readonly maxAttempts: number;
  readonly retryBackoffSeconds: number;
  readonly stuckInFlightSeconds: number;
  readonly queueBatchSize: number;
}

async function readNumber(db: Database, key: string): Promise<number | undefined> {
  const rows = await db.execute<{ [key: string]: unknown; value: unknown }>(sql`
    select value from platform_settings where key = ${key}
  `);
  const raw = rows.rows[0]?.value;
  /*
   * A number, or it is not a setting.
   *
   * `Number(null)` is 0 and `Number("")` is 0, so a coercing read would turn a
   * malformed row into "zero backoff" — retries as fast as the loop can run, a
   * policy change nobody asked for in the worst direction.
   */
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

/** Clamped downward: configuration may permit fewer attempts, never more. */
export async function loadRefundMaxAttempts(db: Database): Promise<number> {
  const raw = await readNumber(db, REFUND_MAX_ATTEMPTS_KEY);
  if (raw === undefined || raw < 1) return DEFAULT_REFUND_MAX_ATTEMPTS;
  return Math.min(Math.floor(raw), DEFAULT_REFUND_MAX_ATTEMPTS);
}

/** Clamped upward: configuration may wait longer between attempts, never less. */
export async function loadRefundRetryBackoffSeconds(db: Database): Promise<number> {
  const raw = await readNumber(db, REFUND_RETRY_BACKOFF_KEY);
  if (raw === undefined || raw < 0) return DEFAULT_REFUND_RETRY_BACKOFF_SECONDS;
  return Math.max(Math.floor(raw), DEFAULT_REFUND_RETRY_BACKOFF_SECONDS);
}

/** Clamped upward: an operator may be more patient before declaring unknown. */
export async function loadRefundStuckInFlightSeconds(db: Database): Promise<number> {
  const raw = await readNumber(db, REFUND_STUCK_IN_FLIGHT_KEY);
  if (raw === undefined || raw < 0) return DEFAULT_REFUND_STUCK_IN_FLIGHT_SECONDS;
  return Math.max(Math.floor(raw), DEFAULT_REFUND_STUCK_IN_FLIGHT_SECONDS);
}

/** Clamped downward: a batch may be smaller than the reviewed size, never larger. */
export async function loadRefundQueueBatchSize(db: Database): Promise<number> {
  const raw = await readNumber(db, REFUND_QUEUE_BATCH_KEY);
  if (raw === undefined || raw < 1) return DEFAULT_REFUND_QUEUE_BATCH_SIZE;
  return Math.min(Math.floor(raw), DEFAULT_REFUND_QUEUE_BATCH_SIZE);
}

export async function loadRefundPolicy(db: Database): Promise<RefundPolicy> {
  const [maxAttempts, retryBackoffSeconds, stuckInFlightSeconds, queueBatchSize] =
    await Promise.all([
      loadRefundMaxAttempts(db),
      loadRefundRetryBackoffSeconds(db),
      loadRefundStuckInFlightSeconds(db),
      loadRefundQueueBatchSize(db),
    ]);
  return { maxAttempts, retryBackoffSeconds, stuckInFlightSeconds, queueBatchSize };
}
