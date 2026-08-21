import { DomainError } from "../errors";

/**
 * The refund state machine, written down once, as data.
 *
 * Five states, and the fifth is the reason the other four are safe.
 *
 *   owed        a refund is due. Recorded automatically the moment an order
 *               reaches `refund_due`, so a debt is never merely implied by an
 *               order status somebody has to remember to query.
 *
 *   in_flight   a request is out. Exactly one attempt may be open at a time.
 *
 *   succeeded   money went back, and we can say how we know. TERMINAL.
 *
 *   failed      the refund provably did not happen — either the request never
 *               reached the provider, or the provider documented a rejection.
 *               Retryable, because there is nothing to duplicate.
 *
 *   in_doubt    we do not know. A timeout, a lost connection, an HTTP 5xx
 *               after transmission, an unparseable answer. NEVER retried.
 *
 * The one transition this file exists to forbid is `in_doubt → in_flight`.
 * Everything else could be argued about; that one cannot, because it is
 * exactly the step that refunds a buyer twice. To retry an `in_doubt` refund
 * you must first resolve it to `failed`, and resolving to `failed` requires
 * evidence — a provider status query, a signed webhook, or a person reading a
 * provider statement. The evidence is the unlock, not the operator's patience.
 *
 * The database enforces the same rules a second time: every mutation is a
 * guarded UPDATE naming the state it expects, and a CHECK constraint refuses a
 * `failed` or `succeeded` row that carries no evidence.
 */

export const REFUND_STATES = [
  "owed",
  "in_flight",
  "succeeded",
  "failed",
  "in_doubt",
] as const;
export type RefundState = (typeof REFUND_STATES)[number];

const REFUND_TRANSITIONS: Readonly<Record<RefundState, readonly RefundState[]>> = {
  // A human authorises; the request goes out.
  owed: ["in_flight"],
  /*
   * Three ends for a request in flight, and the third is the crash-recovery
   * path: an attempt whose process died leaves an open row and a refund that
   * will never hear an answer. Sweeping it to `in_doubt` removes the claim
   * that we are still waiting, and — because `in_doubt` cannot be retried —
   * takes nothing off the table that was safe to do.
   */
  in_flight: ["succeeded", "failed", "in_doubt"],
  succeeded: [],
  // Proven not to have happened, so a further attempt duplicates nothing.
  failed: ["in_flight"],
  /*
   * NOT in_flight. This is the whole point.
   *
   * An unknown outcome may be RESOLVED — to succeeded when evidence says the
   * money went back, to failed when evidence says it did not — and a resolution
   * to `failed` is what makes a retry legal, one state later. There is no path
   * from here that sends a second request without first learning something.
   */
  in_doubt: ["succeeded", "failed"],
};

/** How we came to believe an outcome. Stored, so it can be audited later. */
export const REFUND_RESOLUTION_SOURCES = [
  "response",
  "status_query",
  "webhook",
  "manual_reconciliation",
] as const;
export type RefundResolutionSource = (typeof REFUND_RESOLUTION_SOURCES)[number];

export function canTransitionRefund(from: RefundState, to: RefundState): boolean {
  return REFUND_TRANSITIONS[from].includes(to);
}

export function isTerminalRefundState(state: RefundState): boolean {
  return REFUND_TRANSITIONS[state].length === 0;
}

/**
 * States a refund may be retried from. `in_doubt` is deliberately not among
 * them and there is no flag, option or override that adds it.
 */
export function isRetryableRefundState(state: RefundState): boolean {
  return canTransitionRefund(state, "in_flight");
}

export class InvalidRefundTransitionError extends DomainError {
  override readonly name = "InvalidRefundTransitionError";
  constructor(from: string, to: string) {
    super(
      "refund.invalid_transition",
      from === "in_doubt" && to === "in_flight"
        ? "A refund of unknown outcome is never retried. Resolve it first: query " +
            "the provider, wait for its webhook, or reconcile it manually against " +
            "a provider statement."
        : `A refund cannot go from ${from} to ${to}.`,
    );
  }
}

export function assertRefundTransition(from: RefundState, to: RefundState): void {
  if (!canTransitionRefund(from, to)) throw new InvalidRefundTransitionError(from, to);
}
