import type { Money } from "../money";

/**
 * The payment-provider abstraction.
 *
 * Afrinext codes against this, never against a specific provider. iPayMoney is
 * the confirmed initial provider, but the financial system must not be built
 * around it — a second provider has to be addable without touching the ledger,
 * checkout, or anything else.
 */

export type ChargeStatusValue =
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export interface ChargeInput {
  readonly reference: string;
  readonly amount: Money;
  readonly customer: {
    readonly userId: string;
    readonly phone?: string | undefined;
    readonly email?: string | undefined;
  };
  readonly channel?: string | undefined;
  readonly returnUrl?: string | undefined;
  readonly metadata?: Readonly<Record<string, string>> | undefined;
  readonly idempotencyKey: string;
}

export interface ChargeResult {
  readonly providerRef: string;
  readonly status: ChargeStatusValue;
  /** Where to send the customer, when the provider uses a hosted flow. */
  readonly redirectUrl?: string | undefined;
  readonly raw: unknown;
}

export interface ChargeStatus {
  readonly providerRef: string;
  readonly status: ChargeStatusValue;
  readonly amount: Money;
  readonly raw: unknown;
}

export interface RefundInput {
  readonly providerRef: string;
  readonly amount: Money;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export type RefundStatusValue = "pending" | "succeeded" | "failed";

export interface RefundResult {
  readonly providerRefundRef: string;
  readonly status: RefundStatusValue;
  /**
   * Required to make `failed` mean failed.
   *
   * The provider's own statement that no money moved — an error code its
   * documentation defines as "no refund was created", a rejection reason, a
   * balance refusal. Without it a `failed` is downgraded to `in_doubt`, because
   * an HTTP status alone never proves whether the financial operation happened.
   * See payments/refund-outcome.ts.
   */
  readonly notExecutedEvidence?: string | undefined;
  readonly raw: unknown;
}

/**
 * How a refund is looked up after the fact.
 *
 * Two handles, and which one exists is the difference between an ambiguity a
 * machine can resolve and one that needs a person:
 *
 *   providerRefundRef  the provider named the refund, so we can ask about it.
 *                      Available when the request came back at all.
 *
 *   idempotencyKey     OUR key for the attempt. After a timeout this is the
 *                      ONLY handle we have — the provider may have created a
 *                      refund we were never told the name of. A provider that
 *                      can look up by the caller's idempotency key can resolve
 *                      that case; one that cannot leaves it to a human reading
 *                      a statement.
 *
 * Whether iPayMoney supports the second is item 4 of the refund gaps, and it is
 * design-changing rather than a detail: without it, every timed-out refund is a
 * manual reconciliation.
 */
export interface RefundQuery {
  readonly providerRefundRef?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

/**
 * What a provider says about a refund when asked afterwards.
 *
 * This is how an `in_doubt` refund gets resolved without a human reading a
 * bank statement, so its absence is a real operational cost rather than a
 * missing convenience — see `supportsRefundQuery`.
 */
export interface RefundStatus {
  readonly providerRefundRef: string;
  readonly status: RefundStatusValue;
  readonly amount?: Money | undefined;
  /** Present when the provider states positively that no refund exists. */
  readonly notExecutedEvidence?: string | undefined;
  readonly raw: unknown;
}

export interface PayoutInput {
  readonly reference: string;
  readonly amount: Money;
  readonly beneficiary: {
    readonly userId: string;
    readonly method: string;
    readonly account: string;
    readonly name?: string | undefined;
  };
  readonly idempotencyKey: string;
}

export interface PayoutResult {
  readonly providerRef: string;
  readonly status: "pending" | "succeeded" | "failed";
  readonly raw: unknown;
}

export interface PayoutStatus {
  readonly providerRef: string;
  readonly status: "pending" | "succeeded" | "failed";
  readonly raw: unknown;
}

export interface HeadersLike {
  get(name: string): string | null;
}

/**
 * A webhook that survived signature verification.
 *
 * Discriminated on `subject` because a refund event and a charge event are not
 * the same fact wearing different values: they name different provider objects
 * and move different state machines. An optional discriminator would let a
 * refund event be read as a charge event by any code that forgot to check,
 * which is precisely the class of mistake this union is here to make
 * impossible.
 */
export interface VerifiedChargeEvent {
  readonly subject: "charge";
  /** Provider's own event id. Stored UNIQUE so a replayed webhook is a no-op. */
  readonly providerEventId: string;
  readonly type: string;
  /** The charge's provider reference. */
  readonly providerRef: string;
  readonly status: ChargeStatusValue;
  readonly amount?: Money | undefined;
  readonly raw: unknown;
}

export interface VerifiedRefundEvent {
  readonly subject: "refund";
  readonly providerEventId: string;
  readonly type: string;
  /** The REFUND's provider reference, not the charge's. */
  readonly providerRefundRef: string;
  /** The charge it reverses, when the provider says so. */
  readonly providerRef?: string | undefined;
  readonly status: RefundStatusValue;
  readonly amount?: Money | undefined;
  /** Present when the event states positively that no refund occurred. */
  readonly notExecutedEvidence?: string | undefined;
  readonly raw: unknown;
}

export type VerifiedEvent = VerifiedChargeEvent | VerifiedRefundEvent;

export interface PaymentProvider {
  readonly id: string;
  /** Whether this provider can be selected in the current environment. */
  readonly isConfigured: boolean;

  createCharge(input: ChargeInput): Promise<ChargeResult>;
  getCharge(providerRef: string): Promise<ChargeStatus>;
  /**
   * Verifies a webhook against the RAW body. Parsing before verifying is how
   * signature checks get bypassed, so the raw bytes are the input.
   */
  verifyWebhook(rawBody: Buffer, headers: HeadersLike): Promise<VerifiedEvent>;
  /**
   * Reverses a charge.
   *
   * There is no destination parameter and there never will be: the money goes
   * back the way it came, so no caller — route, action or test — is in a
   * position to redirect it.
   *
   * An implementation that cannot answer MUST throw, and its `RefundTransportError`
   * must carry an honest `stage`. Returning a fabricated `failed` to avoid
   * throwing is how an unknown becomes a retry.
   */
  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Asks what became of a refund. OPTIONAL, and its absence is expensive.
   *
   * This is the only mechanical way an `in_doubt` refund is ever resolved.
   * Without it, every ambiguous refund becomes a human reading a provider
   * statement — which is a workable process, but one the finance team must be
   * told about before launch rather than discovered on the first timeout.
   * Whether iPayMoney offers it is an open question; see
   * docs/providers/ipaymoney/README.md.
   */
  getRefund?(query: RefundQuery): Promise<RefundStatus>;

  /**
   * Optional on purpose. If a provider has no disbursement API, payouts run as
   * an operational batch and the platform still works — but the finance team's
   * workload changes substantially, so callers must handle its absence rather
   * than assume it exists.
   */
  createPayout?(input: PayoutInput): Promise<PayoutResult>;
  getPayout?(providerRef: string): Promise<PayoutStatus>;
}

/**
 * Whether ambiguity can be resolved mechanically for this provider.
 *
 * Callers must branch on this rather than assume. A provider without it is not
 * broken — it simply means an `in_doubt` refund waits for a person.
 */
export function supportsRefundQuery(
  provider: PaymentProvider,
): provider is PaymentProvider & Required<Pick<PaymentProvider, "getRefund">> {
  return typeof provider.getRefund === "function";
}

export function supportsPayouts(
  provider: PaymentProvider,
): provider is PaymentProvider & Required<Pick<PaymentProvider, "createPayout" | "getPayout">> {
  return typeof provider.createPayout === "function" && typeof provider.getPayout === "function";
}
