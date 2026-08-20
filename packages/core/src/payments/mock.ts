import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { money } from "../money";
import type {
  ChargeInput, ChargeResult, ChargeStatus, ChargeStatusValue, HeadersLike, PaymentProvider,
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
  /**
   * When true, `createCharge` answers `pending` and the charge is only resolved
   * by a signed event — which is how every hosted-redirect provider behaves,
   * iPayMoney included as far as anyone can tell without its documentation.
   *
   * This is the default, and the reason is not convenience. A provider that
   * confirms synchronously lets the order domain be written as "call the
   * provider, believe the answer", and that shape does not survive contact with
   * a real one. Making the mock asynchronous forces the verification boundary
   * to exist and to be exercised by every test.
   */
  readonly asynchronous?: boolean;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = "mock";
  readonly isConfigured = true;

  private readonly charges = new Map<string, ChargeStatus>();
  private readonly payouts = new Map<string, PayoutStatus>();
  private readonly webhookSecret: string;
  private readonly failureMarker: string;
  private readonly asynchronous: boolean;
  private readonly nonce = randomBytes(6).toString("hex");
  private sequence = 0;

  constructor(options: MockProviderOptions = {}) {
    /*
     * Refused under a production build, with one deliberate opt-out.
     *
     * `NODE_ENV=production` alone is the wrong test on its own — `next start`
     * sets it for an ordinary local smoke run, and the browser suite now pins
     * it precisely so local and CI agree. So the shape is the one ConsoleSender
     * already uses for verification codes: a SECOND variable, named after what
     * it permits, that somebody has to set on purpose.
     *
     * The property that matters is unchanged. `PAYMENT_PROVIDER` is the
     * variable a misconfigured deployment gets wrong, and getting it wrong
     * still cannot select this provider: accepting orders nobody paid for
     * requires two separate statements, not one typo.
     */
    if (
      process.env["NODE_ENV"] === "production" &&
      process.env["ALLOW_MOCK_PAYMENTS"] !== "yes"
    ) {
      throw new Error(
        "MockPaymentProvider refuses to run with NODE_ENV=production: it would " +
          "confirm payments nobody made. Set PAYMENT_PROVIDER to a real " +
          "provider, or set ALLOW_MOCK_PAYMENTS=yes for an environment that is " +
          "deliberately not taking real money.",
      );
    }
    this.webhookSecret = options.webhookSecret ?? "mock-webhook-secret";
    this.failureMarker = options.failureMarker ?? "FAIL";
    this.asynchronous = options.asynchronous ?? true;
  }

  /**
   * References are globally unique, not merely unique within this process.
   *
   * A real provider's reference identifies a charge for all time, and Afrinext
   * stores it under a unique index for exactly that reason. A bare counter
   * restarts at one whenever the process does, so a second run against a
   * database that still held the first run's rows collided on
   * `mockchg_00000001` and failed the payment update. The sequence stays,
   * because a readable ordinal helps when reading a log; the instance nonce is
   * what makes the reference a reference.
   */
  private nextRef(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.nonce}_${this.sequence.toString().padStart(6, "0")}`;
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
    /*
     * Deterministic, and driven by the REFERENCE rather than by a flag the
     * caller passes at confirmation time. The reference comes from the order,
     * so a test decides the outcome when it creates the product it is going to
     * buy — the same way a real provider's outcome is decided by the buyer's
     * funds and not by our code path.
     */
    const status: ChargeStatusValue = failed ? "failed" : this.asynchronous ? "pending" : "succeeded";
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

  /**
   * Builds the body and headers for an event, exactly as a provider would send.
   *
   * A test helper, but not a back door: what it returns still has to survive
   * `verifyWebhook` and every cross-check the order domain makes afterwards.
   * A test can therefore forge a wrong amount, a wrong reference or a bad
   * signature simply by asking for one, which is how the adversarial cases in
   * this milestone are written.
   */
  event(input: {
    id: string;
    type?: string;
    providerRef: string;
    status: ChargeStatusValue;
    amountMinor?: bigint;
    currency?: string;
    signWith?: string;
  }): { body: Buffer; headers: HeadersLike } {
    const payload = JSON.stringify({
      id: input.id,
      type: input.type ?? `charge.${input.status}`,
      providerRef: input.providerRef,
      status: input.status,
      ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor.toString() } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    });
    const body = Buffer.from(payload, "utf8");
    const signature =
      input.signWith ?? createHmac("sha256", this.webhookSecret).update(body).digest("hex");
    return {
      body,
      headers: { get: (name: string) => (name === "x-mock-signature" ? signature : null) },
    };
  }

  /** The charge a reference points at, for tests that need to drive an event. */
  chargeFor(providerRef: string): ChargeStatus | undefined {
    return this.charges.get(providerRef);
  }

  /**
   * Moves a charge on, the way a provider's own systems would.
   *
   * Kept separate from `event()` so a test can emit an event WITHOUT the
   * provider having moved — which is exactly the stale-callback case.
   */
  advance(providerRef: string, status: ChargeStatusValue): void {
    const existing = this.charges.get(providerRef);
    if (existing === undefined) throw new Error(`Unknown charge ${providerRef}`);
    this.charges.set(providerRef, { ...existing, status });
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
