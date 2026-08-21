import type { RefundResult } from "./provider";

/**
 * How a refund attempt is classified — and the one rule that governs it:
 *
 *     UNKNOWN MUST NEVER BECOME FAILED.
 *
 * This file exists because the obvious classification is wrong and dangerous.
 * The obvious one reads an HTTP status: 2xx is success, 5xx is failure, retry
 * the failures. Applied to money that is a bug with a name — the buyer gets
 * refunded twice, because an HTTP 500 says the provider's web tier had a
 * problem and says NOTHING about whether the refund it had already accepted
 * went through.
 *
 * So the question this file asks is never "what did the response say?" but
 * "how far did the request get?". Three answers:
 *
 *   not_transmitted   we can PROVE the request never reached the provider.
 *                     DNS never resolved; the connection was refused; TLS
 *                     failed at handshake; we never built the request. Nothing
 *                     could have happened, so a retry is safe.
 *
 *   transmitted       the bytes left this process. What the provider did with
 *                     them is a separate question we cannot answer from a
 *                     status code, a timeout or a parse error.
 *
 *   unknown           we cannot even establish whether they left.
 *
 * Only `not_transmitted` — plus a documented business rejection that carries
 * its own evidence — produces `failed`. Everything else is `in_doubt`, and an
 * `in_doubt` refund is never retried. It is resolved: by querying the
 * provider, by a signed webhook, or by a human reading a provider statement.
 */

/** How far a refund request got. The ONLY input to failed-versus-in_doubt. */
export type RefundDeliveryStage = "not_transmitted" | "transmitted" | "unknown";

export type RefundAttemptOutcomeKind = "succeeded" | "pending" | "failed" | "in_doubt";

export interface RefundAttemptOutcome {
  readonly kind: RefundAttemptOutcomeKind;
  readonly stage: RefundDeliveryStage;
  /** Set when the provider named the refund. Required before `succeeded`. */
  readonly providerRefundRef?: string | undefined;
  /** Screened, truncated, safe to store. Never a raw provider body. */
  readonly detail: string;
}

/**
 * The error a provider adapter throws when a request does not come back with a
 * usable answer.
 *
 * The `stage` is the adapter's honest statement about how far the request got,
 * and it is the adapter's most important job. An adapter that cannot tell must
 * say `unknown`; saying `not_transmitted` when it does not know is the one lie
 * that costs real money.
 *
 * Generic rather than refund-specific, because the question "how far did the
 * request get?" is the same question for a charge. A lost response to
 * `createCharge` is exactly as ambiguous as a lost response to `refund()` —
 * the difference today is only that the charge path has nowhere to record the
 * ambiguity, which is a gap rather than a reason to classify it differently.
 */
export class ProviderTransportError extends Error {
  override readonly name: string = "ProviderTransportError";
  readonly stage: RefundDeliveryStage;
  /** The provider's HTTP status, when there was a response at all. */
  readonly httpStatus: number | undefined;

  constructor(message: string, stage: RefundDeliveryStage, httpStatus?: number) {
    super(message);
    this.stage = stage;
    this.httpStatus = httpStatus;
  }
}

/**
 * The same thing, named for the refund path it was written for.
 *
 * Kept as its own class so existing code, tests and mutations that name it
 * continue to mean what they meant; `stageOfTransportFailure` matches the base,
 * so a charge-side error is classified by exactly the same rules.
 */
export class RefundTransportError extends ProviderTransportError {
  override readonly name: string = "RefundTransportError";
}

/**
 * Node/undici error codes that PROVE the request never left for the provider.
 *
 * The list is deliberately short and deliberately closed. Every code here
 * describes a failure that happens before any request bytes are written to a
 * socket the provider is listening on. Anything not on this list is unknown,
 * because the cost of wrongly widening this set is a duplicate refund and the
 * cost of wrongly narrowing it is one manual reconciliation.
 *
 * Notably ABSENT, and each for a reason:
 *
 *   ECONNRESET   the peer reset the connection — which can happen after the
 *                request was fully sent and even after it was processed.
 *   ETIMEDOUT    a timeout says only that no answer came back.
 *   EPIPE        the socket closed mid-write; some bytes may have gone.
 *   ABORT_ERR    we gave up. The provider did not necessarily.
 *   UND_ERR_*    undici's own timeouts, all post-connection.
 */
const PROVEN_NOT_TRANSMITTED: ReadonlySet<string> = new Set([
  // DNS never resolved a host to connect to.
  "ENOTFOUND",
  "EAI_AGAIN",
  // The transport refused or could not reach the host.
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  // TLS failed at handshake, which is before any application bytes.
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  // We never even built a request.
  "ERR_INVALID_URL",
]);

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== error) return codeOf(cause);
  return undefined;
}

/**
 * Classifies a transport-level failure by how far the request got.
 *
 * Adapters may call this instead of deciding for themselves; the shared table
 * is what stops "was this transmitted?" from being answered differently by
 * every provider someone adds later.
 */
export function stageOfTransportFailure(error: unknown): RefundDeliveryStage {
  // The base class, so a charge-side transport error is classified by the same
  // table as a refund-side one.
  if (error instanceof ProviderTransportError) return error.stage;
  const code = codeOf(error);
  if (code !== undefined && PROVEN_NOT_TRANSMITTED.has(code)) return "not_transmitted";
  return "unknown";
}

/**
 * How much of a provider's words we keep. Enough to diagnose, short enough that
 * a leaked credential does not travel far, and screened either way.
 */
const DETAIL_LIMIT = 500;

/**
 * Patterns that look like a secret. Redacted before anything is stored.
 *
 * This is a net, not a proof — no screen can catch every shape a credential
 * takes. It is here because the alternative is storing provider bodies raw,
 * and a bearer token in an operator-visible queue is a worse bug than an
 * over-redacted error message.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /"?\b(?:api[_-]?key|secret|token|password|passphrase|authorization|signature)\b"?\s*[:=]\s*"?[^\s",}]{4,}"?/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,}/g,
];

/** Truncates and screens a provider's own words before they are stored. */
export function screenDetail(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (value instanceof Error) text = `${value.name}: ${value.message}`;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = "[unserialisable provider response]";
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

/**
 * Turns a provider's ANSWER into an outcome.
 *
 * Reached only when the provider actually answered, so the stage is
 * `transmitted` by definition — the request plainly arrived. What remains is
 * whether the answer is credible enough to act on:
 *
 *   succeeded  needs a provider refund reference. "It worked" without a name
 *              for what worked is not something reconciliation could ever
 *              check, so it is treated as unknown instead.
 *
 *   failed     needs `notExecutedEvidence`: the provider's own statement that
 *              no money moved. A bare `status: "failed"` — which is all an
 *              HTTP status can ever justify — becomes `in_doubt`, because a
 *              refund the provider rejected and a refund the provider accepted
 *              and then reported badly look identical from here.
 */
export function classifyRefundResponse(result: RefundResult): RefundAttemptOutcome {
  const detail = screenDetail(result.raw);

  if (result.status === "succeeded") {
    if (result.providerRefundRef === "" || result.providerRefundRef === undefined) {
      return {
        kind: "in_doubt",
        stage: "transmitted",
        detail: `provider reported success without a refund reference: ${detail}`,
      };
    }
    return {
      kind: "succeeded",
      stage: "transmitted",
      providerRefundRef: result.providerRefundRef,
      detail,
    };
  }

  if (result.status === "pending") {
    return {
      kind: "pending",
      stage: "transmitted",
      ...(result.providerRefundRef !== undefined && result.providerRefundRef !== ""
        ? { providerRefundRef: result.providerRefundRef }
        : {}),
      detail,
    };
  }

  // status === "failed" — and this is the branch the correction is about.
  const evidence = result.notExecutedEvidence;
  if (evidence === undefined || evidence.trim() === "") {
    return {
      kind: "in_doubt",
      stage: "transmitted",
      detail:
        "provider reported a failure without evidence that no refund occurred; " +
        `treated as unknown: ${detail}`,
    };
  }
  return {
    kind: "failed",
    stage: "transmitted",
    detail: `${screenDetail(evidence)} | ${detail}`,
  };
}

/** Turns a THROWN failure into an outcome, by how far the request got. */
export function classifyRefundFailure(error: unknown): RefundAttemptOutcome {
  const stage = stageOfTransportFailure(error);
  const detail = screenDetail(error);

  if (stage === "not_transmitted") {
    return {
      kind: "failed",
      stage,
      detail: `request never reached the provider: ${detail}`,
    };
  }
  return {
    kind: "in_doubt",
    stage,
    detail: `outcome unknown after ${stage === "transmitted" ? "transmission" : "an indeterminate failure"}: ${detail}`,
  };
}
