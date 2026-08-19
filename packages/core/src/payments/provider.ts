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

export interface RefundResult {
  readonly providerRefundRef: string;
  readonly status: "pending" | "succeeded" | "failed";
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

export interface VerifiedEvent {
  /** Provider's own event id. Stored UNIQUE so a replayed webhook is a no-op. */
  readonly providerEventId: string;
  readonly type: string;
  readonly providerRef: string;
  readonly status: ChargeStatusValue;
  readonly amount?: Money | undefined;
  readonly raw: unknown;
}

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
  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Optional on purpose. If a provider has no disbursement API, payouts run as
   * an operational batch and the platform still works — but the finance team's
   * workload changes substantially, so callers must handle its absence rather
   * than assume it exists.
   */
  createPayout?(input: PayoutInput): Promise<PayoutResult>;
  getPayout?(providerRef: string): Promise<PayoutStatus>;
}

export function supportsPayouts(
  provider: PaymentProvider,
): provider is PaymentProvider & Required<Pick<PaymentProvider, "createPayout" | "getPayout">> {
  return typeof provider.createPayout === "function" && typeof provider.getPayout === "function";
}
