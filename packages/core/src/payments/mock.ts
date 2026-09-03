import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { money } from "../money";
import { RefundTransportError } from "./refund-outcome";
import type {
  ChargeInput, ChargeResult, ChargeStatus, ChargeStatusValue, HeadersLike, PaymentProvider,
  PayoutInput, PayoutResult, PayoutStatus, RefundInput, RefundResult, RefundStatus,
  RefundQuery, RefundStatusValue, VerifiedEvent,
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

/** How the mock provider will answer a refund. See MockPaymentProvider.refund. */
export type MockRefundScenario =
  | "succeeds"
  | "succeeds_without_ref"
  | "rejects"
  | "rejects_without_evidence"
  | "timeout_executed"
  | "timeout_not_executed"
  | "connection_lost"
  | "http_500"
  | "malformed"
  | "dns_failure"
  | "connection_refused"
  | "pending";

export class MockPaymentProvider implements PaymentProvider {
  readonly id = "mock";
  readonly isConfigured = true;
  /**
   * The mock states the amount, and that is deliberate rather than incidental.
   *
   * It is what keeps the webhook boundary's exact amount cross-check exercised
   * by the whole suite. A real provider that says nothing about the amount —
   * iPayMoney is one — leaves that check unreachable, so if the mock also went
   * silent the check would have no test anywhere.
   */
  readonly statesChargeAmount = true;

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
      subject?: "charge" | "refund";
      providerRef: string;
      providerRefundRef?: string;
      status: string;
      amountMinor?: string;
      currency?: string;
      notExecutedEvidence?: string;
    };

    if (parsed.subject === "refund") {
      return Promise.resolve({
        subject: "refund" as const,
        providerEventId: parsed.id,
        type: parsed.type,
        providerRefundRef: parsed.providerRefundRef ?? parsed.providerRef,
        ...(parsed.providerRef !== undefined ? { providerRef: parsed.providerRef } : {}),
        status: parsed.status as RefundStatusValue,
        amount:
          parsed.amountMinor !== undefined && parsed.currency !== undefined
            ? money(BigInt(parsed.amountMinor), parsed.currency)
            : undefined,
        ...(parsed.notExecutedEvidence !== undefined
          ? { notExecutedEvidence: parsed.notExecutedEvidence }
          : {}),
        raw: parsed,
      });
    }

    return Promise.resolve({
      subject: "charge" as const,
      providerEventId: parsed.id,
      type: parsed.type,
      providerRef: parsed.providerRef,
      status: parsed.status as ChargeStatusValue,
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
      subject: "charge",
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

  /*
   * -----------------------------------------------------------------------
   * Refunds
   * -----------------------------------------------------------------------
   *
   * The scenarios below are the whole reason this mock exists for Phase 3.
   * They are not conveniences: each one is a way a real provider fails that
   * the refund domain must survive, and several of them are impossible to
   * produce from a well-behaved provider on demand.
   *
   * The scenario is set on the PROVIDER, keyed by charge reference, before the
   * refund is requested — never passed at the call site. That distinction
   * matters: a test that chose the outcome when calling `refund()` would be
   * testing a branch of our own code, whereas a provider configured in advance
   * is the provider deciding, which is what actually happens.
   */

  /**
   * How the provider will behave when asked to refund a particular charge.
   *
   *   succeeds                  ordinary success, with a reference.
   *   succeeds_without_ref      success claimed with nothing to name it. Must
   *                             be treated as unknown, not success.
   *   rejects                   a documented business rejection carrying
   *                             evidence that no money moved. The only shape
   *                             that may become `failed` from a response.
   *   rejects_without_evidence  a bare "failed". Indistinguishable from an
   *                             accepted refund reported badly, so: unknown.
   *   timeout_executed          the request went out, the provider DID refund,
   *                             and we never heard. The dangerous one.
   *   timeout_not_executed      the request went out, nothing happened, and we
   *                             never heard. Identical from here — which is
   *                             the point.
   *   connection_lost           reset after transmission. Unknown.
   *   http_500                  a 5xx AFTER the request reached the provider.
   *                             Unknown, and this is the case the approved
   *                             design was corrected to get right.
   *   malformed                 an answer that cannot be parsed. Unknown.
   *   dns_failure               ENOTFOUND. Proven never transmitted.
   *   connection_refused        ECONNREFUSED. Proven never transmitted.
   *   pending                   accepted, outcome to arrive by webhook.
   */
  static readonly REFUND_SCENARIOS = [
    "succeeds", "succeeds_without_ref", "rejects", "rejects_without_evidence",
    "timeout_executed", "timeout_not_executed", "connection_lost", "http_500",
    "malformed", "dns_failure", "connection_refused", "pending",
  ] as const;

  private readonly refundPlans = new Map<string, MockRefundScenario>();
  /** What the provider actually did, keyed by its own reference. */
  private readonly refundsIssued = new Map<string, RefundStatus>();
  /**
   * The same truth keyed by OUR idempotency key.
   *
   * This is the map that makes a timed-out refund resolvable: the provider
   * performed something, we never learned its reference, and the only handle
   * left is the key we sent. A provider that keeps this index can answer
   * "what happened to my request?"; one that does not leaves a person to read
   * a statement, which is why its existence is an open iPayMoney question
   * rather than an implementation detail.
   */
  private readonly refundTruthByKey = new Map<string, RefundStatus>();
  /** Refunds the provider performed but never successfully reported. */
  private readonly silentRefunds = new Map<string, RefundStatus>();
  private readonly refundsByKey = new Map<string, RefundResult>();

  /** Decides, in advance, how this provider will answer a refund of a charge. */
  planRefund(providerRef: string, scenario: MockRefundScenario): void {
    this.refundPlans.set(providerRef, scenario);
  }

  refund(input: RefundInput): Promise<RefundResult> {
    const charge = this.charges.get(input.providerRef);
    if (charge === undefined) {
      return Promise.reject(new Error(`Unknown charge ${input.providerRef}`));
    }

    /*
     * Provider-side idempotency, keyed on OUR key.
     *
     * A real provider that supports idempotency keys answers a repeated key
     * with the original outcome rather than refunding again. Modelling that
     * here is what lets a test show the difference between a system that
     * relies on it and one that does not — Afrinext does not rely on it, and
     * the tests prove the safety holds even when this map is empty.
     */
    const seen = this.refundsByKey.get(input.idempotencyKey);
    if (seen !== undefined) return Promise.resolve(seen);

    const scenario = this.refundPlans.get(input.providerRef) ?? "succeeds";
    const providerRefundRef = this.nextRef("mockrfd");
    const raw = {
      of: input.providerRef,
      amountMinor: input.amount.amountMinor.toString(),
      currency: input.amount.currency,
      scenario,
    };

    const record = (status: RefundStatusValue, evidence?: string): RefundStatus => {
      const truth: RefundStatus = {
        providerRefundRef,
        status,
        amount: input.amount,
        ...(evidence !== undefined ? { notExecutedEvidence: evidence } : {}),
        raw,
      };
      // Indexed both ways, because after a timeout our key is all we have.
      this.refundTruthByKey.set(input.idempotencyKey, truth);
      return truth;
    };

    const answer = (result: RefundResult): Promise<RefundResult> => {
      this.refundsByKey.set(input.idempotencyKey, result);
      return Promise.resolve(result);
    };

    switch (scenario) {
      case "succeeds":
        this.refundsIssued.set(providerRefundRef, record("succeeded"));
        return answer({ providerRefundRef, status: "succeeded", raw });

      case "succeeds_without_ref":
        this.refundsIssued.set(providerRefundRef, record("succeeded"));
        return answer({ providerRefundRef: "", status: "succeeded", raw });

      case "pending":
        this.refundsIssued.set(providerRefundRef, record("pending"));
        return answer({ providerRefundRef, status: "pending", raw });

      case "rejects":
        return answer({
          providerRefundRef,
          status: "failed",
          notExecutedEvidence:
            "provider error REFUND_WINDOW_CLOSED: no refund was created for this charge",
          raw,
        });

      case "rejects_without_evidence":
        // No evidence. Deliberately ambiguous, and must not become `failed`.
        return answer({ providerRefundRef, status: "failed", raw });

      case "timeout_executed":
        // The refund HAPPENED. We simply never learned it — which is exactly
        // why a timeout may never be read as "it did not happen".
        this.silentRefunds.set(providerRefundRef, record("succeeded"));
        this.refundsIssued.set(providerRefundRef, record("succeeded"));
        return Promise.reject(
          new RefundTransportError("socket timed out awaiting response", "unknown"),
        );

      case "timeout_not_executed":
        return Promise.reject(
          new RefundTransportError("socket timed out awaiting response", "unknown"),
        );

      case "connection_lost":
        return Promise.reject(
          Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
        );

      case "http_500":
        // Reached the provider. Answered badly. Says nothing about the money.
        this.silentRefunds.set(providerRefundRef, record("succeeded"));
        this.refundsIssued.set(providerRefundRef, record("succeeded"));
        return Promise.reject(
          new RefundTransportError("provider returned 500", "transmitted", 500),
        );

      case "malformed":
        return Promise.reject(
          new RefundTransportError(
            "could not parse the provider response: <html>502 Bad Gateway</html>",
            "transmitted",
          ),
        );

      case "dns_failure":
        return Promise.reject(
          Object.assign(new Error("getaddrinfo ENOTFOUND api.example"), { code: "ENOTFOUND" }),
        );

      case "connection_refused":
        return Promise.reject(
          Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        );
    }
  }

  /**
   * What became of a refund.
   *
   * Answers about refunds this provider actually performed, including the ones
   * it never managed to report — which is how an `in_doubt` refund is resolved
   * to the truth rather than to a guess. A reference it has never issued gets a
   * positive "no such refund", because "I have no record of this" is itself
   * evidence a provider can give.
   */
  getRefund(query: RefundQuery): Promise<RefundStatus> {
    if (query.providerRefundRef !== undefined && query.providerRefundRef !== "") {
      const byRef = this.refundsIssued.get(query.providerRefundRef);
      if (byRef !== undefined) return Promise.resolve(byRef);
    }
    if (query.idempotencyKey !== undefined) {
      const byKey = this.refundTruthByKey.get(query.idempotencyKey);
      if (byKey !== undefined) return Promise.resolve(byKey);
    }
    /*
     * "I have no record of this."
     *
     * A positive statement, not a shrug — which is why it carries evidence and
     * may therefore resolve an in_doubt refund to `failed`. A provider that
     * answered "I don't know" instead would leave the refund exactly where it
     * was, and rightly.
     */
    const ref = query.providerRefundRef ?? query.idempotencyKey ?? "";
    return Promise.resolve({
      providerRefundRef: ref,
      status: "failed",
      notExecutedEvidence: "no refund exists under that reference",
      raw: { query: { ...query }, known: false },
    });
  }

  /** Test helper: did the provider actually move money for this reference? */
  refundHappened(providerRefundRef: string): boolean {
    return this.refundsIssued.get(providerRefundRef)?.status === "succeeded";
  }

  /** How many refunds this provider actually performed. The duplicate check. */
  refundsPerformed(): number {
    return [...this.refundsIssued.values()].filter((r) => r.status === "succeeded").length;
  }

  /** Test helper: the reference of a refund the provider never got to report. */
  silentRefundRefs(): readonly string[] {
    return [...this.silentRefunds.keys()];
  }

  /**
   * A refund webhook, exactly as a provider would send it.
   *
   * Like `event()`, a helper and not a back door: what it returns still has to
   * survive signature verification and every cross-check the refund domain
   * makes afterwards.
   */
  refundEvent(input: {
    id: string;
    providerRefundRef: string;
    status: RefundStatusValue;
    providerRef?: string;
    amountMinor?: bigint;
    currency?: string;
    notExecutedEvidence?: string;
    signWith?: string;
  }): { body: Buffer; headers: HeadersLike } {
    const payload = JSON.stringify({
      id: input.id,
      subject: "refund",
      type: `refund.${input.status}`,
      providerRefundRef: input.providerRefundRef,
      ...(input.providerRef !== undefined ? { providerRef: input.providerRef } : {}),
      status: input.status,
      ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor.toString() } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.notExecutedEvidence !== undefined
        ? { notExecutedEvidence: input.notExecutedEvidence }
        : {}),
    });
    const body = Buffer.from(payload, "utf8");
    const signature =
      input.signWith ?? createHmac("sha256", this.webhookSecret).update(body).digest("hex");
    return {
      body,
      headers: { get: (name: string) => (name === "x-mock-signature" ? signature : null) },
    };
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
