import { createHmac, timingSafeEqual } from "node:crypto";
import { money } from "../money";
import type {
  ChargeInput, ChargeResult, ChargeStatus, HeadersLike, PaymentProvider,
  PayoutInput, PayoutResult, PayoutStatus, RefundInput, RefundResult, VerifiedEvent,
} from "./provider";

/**
 * A deterministic in-process payment provider for development and tests.
 *
 * It exists so the whole economic cycle — checkout, capture, settlement,
 * payout, refund — can be exercised end to end without any real provider, and
 * so the ledger tests do not depend on a third party being reachable.
 *
 * It refuses to load in production. A mock that can be selected by a
 * misconfigured environment variable is a way to take orders that were never
 * paid for.
 */
export interface MockProviderOptions {
  readonly webhookSecret?: string;
  /** Charges whose reference contains this string fail instead of succeeding. */
  readonly failureMarker?: string;
  readonly now?: () => number;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = "mock";
  readonly isConfigured = true;

  private readonly charges = new Map<string, ChargeStatus>();
  private readonly payouts = new Map<string, PayoutStatus>();
  private readonly webhookSecret: string;
  private readonly failureMarker: string;
  private sequence = 0;

  constructor(options: MockProviderOptions = {}) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error(
        "MockPaymentProvider must never be constructed in production. " +
          "Set PAYMENT_PROVIDER to a real provider.",
      );
    }
    this.webhookSecret = options.webhookSecret ?? "mock-webhook-secret";
    this.failureMarker = options.failureMarker ?? "FAIL";
  }

  private nextRef(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(8, "0")}`;
  }

  createCharge(input: ChargeInput): Promise<ChargeResult> {
    const existing = [...this.charges.values()].find(
      (c) => (c.raw as { idempotencyKey?: string }).idempotencyKey === input.idempotencyKey,
    );
    if (existing !== undefined) {
      return Promise.resolve({
        providerRef: existing.providerRef,
        status: existing.status,
        raw: existing.raw,
      });
    }

    const providerRef = this.nextRef("mockchg");
    const failed = input.reference.includes(this.failureMarker);
    const status = failed ? "failed" : "succeeded";
    const record: ChargeStatus = {
      providerRef,
      status,
      amount: input.amount,
      raw: { idempotencyKey: input.idempotencyKey, reference: input.reference },
    };
    this.charges.set(providerRef, record);
    return Promise.resolve({ providerRef, status, raw: record.raw });
  }

  getCharge(providerRef: string): Promise<ChargeStatus> {
    const found = this.charges.get(providerRef);
    if (found === undefined) return Promise.reject(new Error(`Unknown charge ${providerRef}`));
    return Promise.resolve(found);
  }

  /** Mirrors the shape a real provider webhook check must take: raw body, HMAC, constant time. */
  verifyWebhook(rawBody: Buffer, headers: HeadersLike): Promise<VerifiedEvent> {
    const signature = headers.get("x-mock-signature");
    if (signature === null) return Promise.reject(new Error("Missing webhook signature."));

    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return Promise.reject(new Error("Webhook signature does not verify."));
    }

    const parsed = JSON.parse(rawBody.toString("utf8")) as {
      id: string;
      type: string;
      providerRef: string;
      status: ChargeStatus["status"];
      amountMinor?: string;
      currency?: string;
    };

    return Promise.resolve({
      providerEventId: parsed.id,
      type: parsed.type,
      providerRef: parsed.providerRef,
      status: parsed.status,
      amount:
        parsed.amountMinor !== undefined && parsed.currency !== undefined
          ? money(BigInt(parsed.amountMinor), parsed.currency)
          : undefined,
      raw: parsed,
    });
  }

  /** Test helper: produces the signature a caller must send. */
  signWebhook(rawBody: Buffer): string {
    return createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
  }

  refund(input: RefundInput): Promise<RefundResult> {
    const charge = this.charges.get(input.providerRef);
    if (charge === undefined) return Promise.reject(new Error(`Unknown charge ${input.providerRef}`));
    return Promise.resolve({
      providerRefundRef: this.nextRef("mockrfd"),
      status: "succeeded",
      raw: { of: input.providerRef, amountMinor: input.amount.amountMinor.toString() },
    });
  }

  createPayout(input: PayoutInput): Promise<PayoutResult> {
    const providerRef = this.nextRef("mockpay");
    const failed = input.reference.includes(this.failureMarker);
    const status = failed ? "failed" : "succeeded";
    this.payouts.set(providerRef, { providerRef, status, raw: { reference: input.reference } });
    return Promise.resolve({ providerRef, status, raw: { reference: input.reference } });
  }

  getPayout(providerRef: string): Promise<PayoutStatus> {
    const found = this.payouts.get(providerRef);
    if (found === undefined) return Promise.reject(new Error(`Unknown payout ${providerRef}`));
    return Promise.resolve(found);
  }
}
