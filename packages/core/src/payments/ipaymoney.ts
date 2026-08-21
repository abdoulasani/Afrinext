import { timingSafeEqual } from "node:crypto";
import { ProviderNotConfiguredError } from "../errors";
import { ProviderTransportError, screenDetail, stageOfTransportFailure } from "./refund-outcome";
import type {
  ChargeInput, ChargeResult, ChargeStatus, ChargeStatusValue, HeadersLike,
  PaymentProvider, RefundInput, RefundQuery, RefundResult, RefundStatus, VerifiedEvent,
} from "./provider";

/**
 * iPayMoney adapter — payments implemented, refunds and webhooks not.
 *
 * The official documentation is now in `docs/providers/ipaymoney/`:
 * `Documentation-de-iPayMoney.docx` is authoritative and
 * `documentation-extract.md` is a verbatim text extract, so every claim in this
 * file can be checked against a line number rather than against memory.
 *
 * What the documentation establishes, and what this file therefore implements:
 *
 *   POST /api/v1/payments             createCharge()   — L161
 *   GET  /api/v1/payments/{reference} getCharge()      — L228
 *
 *   webhook                           verifyWebhook()  — L308–L368
 *
 * The webhook is implemented as a NOTIFICATION, not as evidence, and that is
 * the load-bearing decision in this adapter. iPayMoney's documented
 * authentication is the API secret echoed back in a header, which does not
 * cover the request body — so a party holding the secret could otherwise forge
 * any confirmation, for any payment, with no amount check to stop it. Instead
 * the header is checked, and then the payment status is re-read from
 * `GET /api/v1/payments/{reference}` over our own authenticated connection.
 * Forging a notification therefore buys nothing: it can make us ask a question,
 * never answer one. See `verifyWebhook` for the full argument.
 *
 * What the documentation does NOT establish, and what therefore still throws:
 *
 *   refund()         there is NO customer-refund operation anywhere in the
 *   getRefund()      documentation. Not an endpoint, not a method, not a
 *                    payload, not a status, not a webhook, not a fee. The word
 *                    « remboursement » appears thirty times and every one of
 *                    them means REVERSEMENT — the merchant withdrawing their
 *                    own balance to their own account. These stay throwing
 *                    until iPayMoney confirms an actual customer-refund
 *                    capability, and no part of this file may be read as one.
 *
 * NOTHING HERE HAS EVER BEEN RUN AGAINST iPayMoney. There are no sandbox
 * credentials in this repository and no request has been made. The code below
 * is written against the documentation and is a hypothesis until a real
 * sandbox run confirms it — which is what `ipaymoney.integration.test.ts` is
 * for, and why it stays skipped.
 */

/** Where the API lives. Overridable so a sandbox host can differ. */
const DEFAULT_BASE_URL = "https://i-pay.money";

/**
 * How long we wait before giving up on a request.
 *
 * A timeout is NOT evidence that the provider did nothing. This bounds how long
 * a request handler blocks; it says nothing about what we are then entitled to
 * conclude, which `stageOfTransportFailure` decides.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The only currency the documentation describes.
 *
 * Refusing everything else is not caution for its own sake. `amount` is sent as
 * a decimal string and the documentation never states its unit; the reason
 * whole-francs is safe for XOF is that XOF has zero decimal places, so a minor
 * unit IS a franc. That reasoning does not survive a currency with an exponent,
 * and a wrong exponent is a 100× error on real money. See assumption A3.
 */
const SUPPORTED_CURRENCY = "XOF";

/**
 * The provider's status values, mapped explicitly and exhaustively.
 *
 * Only these two appear anywhere in the documentation (L183, L246, L364). The
 * SANDBOX names five *scenarios* — success, error, insufficient_fund, declined,
 * pending — and a scenario is not a status: the documentation never shows what
 * `status` field a declined payment actually carries.
 *
 * So the map has two entries and anything else is refused rather than guessed.
 * Refusing is the point: the first sandbox run against a declined test number
 * will report the exact string, and then it can be added on evidence. Mapping
 * an unrecognised status to something plausible would convert that evidence
 * into a silent assumption.
 */
export const IPAYMONEY_STATUS_MAP: Readonly<Record<string, ChargeStatusValue>> = Object.freeze({
  succeeded: "succeeded",
  failed: "failed",
});

/**
 * The event id iPayMoney does not send, derived so a replay is still a no-op.
 *
 * Afrinext's replay defence is `UNIQUE (provider, provider_event_id)` on
 * `payment_events`. iPayMoney supplies no event id (question K9) and retries a
 * delivery five times on any non-2xx (L329), so duplicates are not a
 * possibility to guard against — they are the documented behaviour.
 *
 * The derivation is `{reference}:{status}`, and both halves earn their place:
 *
 *   reference   iPayMoney's own identifier for the payment. Two different
 *               payments therefore cannot collide, whatever else is equal.
 *
 *   status      so a success and a failure for the SAME payment do not collapse
 *               into one another. Keying on the reference alone would mean a
 *               later, truthful event was silently discarded as a duplicate of
 *               an earlier, different one.
 *
 * The status used is the CONFIRMED one — read back from the provider — never
 * the one the notification claimed. That matters: keying on a claimed value
 * would let anyone who can reach the endpoint mint fresh ids at will, and each
 * fresh id is a row and a lookup. Keying on the confirmed value means the id
 * is a function of the provider's own truth, so five deliveries of one real
 * event produce one id and one row.
 *
 * What it deliberately does NOT include is any hash of the request body.
 * Byte-level differences between retries — a re-serialised field order, a
 * changed User-Agent echoed into the payload — would produce different ids and
 * defeat the deduplication this exists for. The id names the FACT, not the
 * delivery.
 */
export function ipaymoneyEventId(providerRef: string, confirmedStatus: string): string {
  return `${providerRef}:${confirmedStatus}`;
}

export class IPayMoneyUnknownStatusError extends Error {
  override readonly name = "IPayMoneyUnknownStatusError";
  constructor(readonly reported: string) {
    super(
      `iPayMoney reported the status "${reported}", which the documentation does ` +
        "not define. Refusing to guess what it means for the money. Record the " +
        "value, confirm it with iPayMoney, then add it to IPAYMONEY_STATUS_MAP.",
    );
  }
}

export interface IPayMoneyOptions {
  readonly baseUrl?: string | undefined;
  /** The secret key. Read from the environment; never committed. */
  readonly apiKey?: string | undefined;
  /** `sandbox` or `live`, sent as `Ipay-Target-Environment`. */
  readonly environment?: string | undefined;
  /**
   * The value iPayMoney echoes in the webhook header.
   *
   * The documentation says this IS the API secret — the dashboard's
   * "Secret Hash" field is where you paste your secret key. It is separate here
   * anyway, so that if the two ever diverge the webhook secret can be rotated
   * without rotating the key that authorises charges.
   */
  readonly webhookSecret?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Injectable for tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch | undefined;
}

interface CreatePaymentResponse {
  status?: unknown;
  reference?: unknown;
  message?: unknown;
}

interface PaymentStatusResponse {
  external_reference?: unknown;
  reference?: unknown;
  status?: unknown;
  msisdn?: unknown;
}

export class IPayMoneyProvider implements PaymentProvider {
  readonly id = "ipaymoney";

  /**
   * iPayMoney states an amount NOWHERE.
   *
   * Not in the payment-status response (L241–L249), not in the webhook payload
   * (L359–L368). The consequence is concrete and is not the adapter's to fix:
   * the webhook boundary's exact amount cross-check has nothing to compare
   * against, so for this provider it cannot run. Declaring `false` is what
   * turns that from a footnote into something a caller can branch on and a test
   * can assert. It is question K8 to iPayMoney.
   */
  readonly statesChargeAmount = false;

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly environment: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IPayMoneyOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env["IPAYMONEY_BASE_URL"] ?? DEFAULT_BASE_URL)
      .replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? process.env["IPAYMONEY_API_KEY"];
    this.environment = options.environment ?? process.env["IPAYMONEY_ENVIRONMENT"];
    // Defaults to the API key, because the documentation says the dashboard's
    // "Secret Hash" field is where the API secret is pasted.
    this.webhookSecret =
      options.webhookSecret ?? process.env["IPAYMONEY_WEBHOOK_SECRET"] ?? this.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Configured means credentials AND a declared environment.
   *
   * The environment is not a detail: `Ipay-Target-Environment` decides whether
   * a request moves real money, and a missing value must never default to
   * `live`. There is no default here at all — somebody says which one, or the
   * provider is not configured.
   */
  get isConfigured(): boolean {
    return (
      this.apiKey !== undefined && this.apiKey !== "" &&
      (this.environment === "sandbox" || this.environment === "live")
    );
  }

  private credentials(): { apiKey: string; environment: string } {
    if (!this.isConfigured) {
      throw new ProviderNotConfiguredError(
        this.id,
        "IPAYMONEY_API_KEY and IPAYMONEY_ENVIRONMENT (sandbox|live) must both be " +
          "set. The environment has no default: defaulting it would decide, on " +
          "nobody's authority, whether a request moves real money.",
      );
    }
    return { apiKey: this.apiKey as string, environment: this.environment as string };
  }

  /**
   * Headers, exactly as documented at L162–L168.
   *
   * `Ipay-Payment-Type` is `mobile` or `card` and there is no documented
   * default, so it is taken from the caller's channel and refused if absent.
   */
  private headers(paymentType: string): Record<string, string> {
    const { apiKey, environment } = this.credentials();
    return {
      "Ipay-Payment-Type": paymentType,
      "Ipay-Target-Environment": environment,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * A documented 4xx is a definite refusal: the request was rejected and no
   * payment was created. Everything else is NOT.
   *
   * This is the same rule the refund path enforces, applied to charges. A 5xx
   * means iPayMoney's server had a problem; the documentation says nothing
   * about what that implies for the transaction (question K14), so it is
   * `transmitted` — the bytes arrived, the outcome is unknown. Reading it as a
   * failure would be convenient and unsupported.
   */
  private async request(
    method: "GET" | "POST",
    path: string,
    paymentType: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown; text: string }> {
    const url = `${this.baseUrl}${path}`;

    /*
     * Headers are built OUTSIDE the try, and that is not a style choice.
     *
     * `headers()` checks the credentials, and a missing API key throws. If that
     * throw happened inside the catch below it would be reclassified as a
     * transport failure of stage `unknown` — which says "the request may have
     * reached the provider and we do not know what happened". The truth is the
     * exact opposite: with no credentials we never built a request at all, so
     * nothing could have happened.
     *
     * Getting this backwards is the same mistake in the same direction the
     * whole refund phase exists to prevent, one layer down: a configuration
     * error would become an ambiguous payment. An existing test caught it.
     */
    const headers = this.headers(paymentType);
    const requestBody = body !== undefined ? JSON.stringify(body) : undefined;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      /*
       * Classified by how far the request got, never by what came back —
       * because nothing came back. `stageOfTransportFailure` owns the table of
       * which error codes prove non-transmission; DNS and connection-refused
       * do, a timeout and a reset do not.
       */
      const stage = stageOfTransportFailure(error);
      throw new ProviderTransportError(
        `iPayMoney ${method} ${path} did not answer: ${screenDetail(error)}`,
        stage,
      );
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }

    if (response.status >= 500) {
      throw new ProviderTransportError(
        `iPayMoney ${method} ${path} answered ${response.status}. The documentation ` +
          "does not say what a server error means for the transaction, so the " +
          "outcome is unknown rather than failed.",
        "transmitted",
        response.status,
      );
    }

    return { status: response.status, json, text };
  }

  private mapStatus(reported: unknown): ChargeStatusValue {
    if (typeof reported !== "string") {
      throw new IPayMoneyUnknownStatusError(String(reported));
    }
    const mapped = IPAYMONEY_STATUS_MAP[reported];
    if (mapped === undefined) throw new IPayMoneyUnknownStatusError(reported);
    return mapped;
  }

  /**
   * Creates a payment. `POST /api/v1/payments` — L161.
   *
   * Three fields iPayMoney requires have no home in `ChargeInput`, and rather
   * than inventing values they are read from `metadata` and refused if absent:
   *
   *   msisdn         the payer's number. `customer.phone` when given, else
   *                  `metadata.msisdn`.
   *   country        "le code du pays de transaction" (L174). WHOSE country —
   *                  the buyer's or the merchant's — is not stated, so it is
   *                  not guessed. Question K17.
   *   customer_name  listed in the body table with no optionality marked, and
   *                  the 400 response mentions "Missing params", so it is
   *                  treated as required.
   *
   * Refusing is the honest failure. A charge that reaches iPayMoney with a
   * guessed country is a charge nobody decided the shape of.
   */
  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    if (input.amount.currency !== SUPPORTED_CURRENCY) {
      throw new ProviderNotConfiguredError(
        this.id,
        `only ${SUPPORTED_CURRENCY} is documented for iPayMoney; refusing to send ` +
          `${input.amount.currency}, whose minor-unit exponent this adapter has no ` +
          "documented way to express in the request.",
      );
    }

    const metadata = input.metadata ?? {};
    const msisdn = input.customer.phone ?? metadata["msisdn"];
    const country = metadata["country"];
    const customerName = metadata["customerName"];
    const paymentType = input.channel ?? metadata["paymentType"];

    const missing = [
      msisdn === undefined || msisdn === "" ? "msisdn (customer.phone or metadata.msisdn)" : null,
      country === undefined || country === "" ? "country (metadata.country)" : null,
      customerName === undefined || customerName === ""
        ? "customer_name (metadata.customerName)" : null,
      paymentType !== "mobile" && paymentType !== "card"
        ? 'payment type (channel must be "mobile" or "card")' : null,
    ].filter((m): m is string => m !== null);

    if (missing.length > 0) {
      throw new ProviderNotConfiguredError(
        this.id,
        `iPayMoney requires ${missing.join(", ")}. These are not guessed: the ` +
          "country in particular is documented only as \"le code du pays de la " +
          "transaction\", and whether that is the buyer's country or the " +
          "merchant's is question K17.",
      );
    }

    /*
     * `transaction_id` is OUR reference, and the derived idempotency key is
     * what goes in it.
     *
     * The documentation says a reference is unique and cannot be reused
     * (L126), and a reuse answers 422 (L218–L224). That is safe — it cannot
     * double-charge — but it is a REJECTION, not an idempotent replay of the
     * original: a retry after a lost response gets 422 and still learns
     * nothing about what happened the first time. That gap is question K10.
     */
    const { status, json } = await this.request("POST", "/api/v1/payments", paymentType as string, {
      customer_name: customerName,
      currency: input.amount.currency,
      country,
      // Whole francs, because XOF has zero decimal places so a minor unit IS a
      // franc. Assumption A3, and question K13.
      amount: input.amount.amountMinor.toString(),
      transaction_id: input.idempotencyKey,
      msisdn,
    });

    const payload = (json ?? {}) as CreatePaymentResponse;

    if (status !== 200) {
      /*
       * A documented 4xx is evidence that no payment was created — the request
       * was refused before anything happened. That is the ONLY shape here that
       * may become a definite failure; 5xx already threw above.
       */
      const detail = typeof payload.message === "string" ? payload.message : `HTTP ${status}`;
      throw new ProviderNotConfiguredError(
        this.id,
        `iPayMoney refused the payment request (${status}): ${detail}. No payment ` +
          "was created.",
      );
    }

    const reference = payload.reference;
    if (typeof reference !== "string" || reference === "") {
      /*
       * A 200 with no reference is not a success we can act on: there would be
       * nothing to query and nothing for a webhook to match. Unknown, not
       * failed — the payment may well exist.
       */
      throw new ProviderTransportError(
        "iPayMoney answered 200 without a reference. The payment may exist and " +
          "cannot be identified, so its outcome is unknown.",
        "transmitted",
        status,
      );
    }

    /*
     * The provider's own status is reported faithfully, INCLUDING a synchronous
     * "succeeded".
     *
     * It is not this adapter's job to soften it. `initiatePayment` clamps
     * anything that is not a definite refusal to `pending` and confirms nothing
     * until a verified event arrives — a decision taken in Phase 2 against a
     * mock, on the argument that a synchronous answer travels on a connection
     * the caller may influence. iPayMoney turns out to answer synchronously AND
     * send a webhook for the same fact, so that argument was right about the
     * real provider. Reporting truthfully here and clamping there keeps the two
     * responsibilities where they were put.
     */
    return {
      providerRef: reference,
      status: this.mapStatus(payload.status),
      raw: payload,
    };
  }

  /**
   * Asks what became of a payment. `GET /api/v1/payments/{reference}` — L228.
   *
   * The path parameter is iPayMoney's reference — *"la référence que vous avez
   * reçu en réponse lors du Post"* (L232). It is NOT our `transaction_id`, and
   * this adapter does not pretend otherwise: if the POST response was lost we
   * hold no reference, and there is no documented way to ask what became of our
   * own identifier. That is question K10, and until it is answered such a
   * charge stays unresolvable rather than being resolved by a lookup that may
   * not exist.
   *
   * The response carries no amount, so `amount` is absent. See
   * `statesChargeAmount`.
   */
  async getCharge(providerRef: string): Promise<ChargeStatus> {
    if (providerRef === "") {
      throw new ProviderNotConfiguredError(
        this.id,
        "a payment can only be queried by iPayMoney's own reference, and none was " +
          "given. Our transaction_id is not a documented lookup key (question K10).",
      );
    }

    const { status, json } = await this.request(
      "GET",
      `/api/v1/payments/${encodeURIComponent(providerRef)}`,
      // The documentation requires the header on this endpoint too but the
      // reference already identifies the payment, so the value cannot change
      // which payment is returned.
      "mobile",
    );

    if (status !== 200) {
      throw new ProviderNotConfiguredError(
        this.id,
        `iPayMoney answered ${status} for payment ${providerRef}.`,
      );
    }

    const payload = (json ?? {}) as PaymentStatusResponse;
    return {
      providerRef:
        typeof payload.reference === "string" && payload.reference !== ""
          ? payload.reference
          : providerRef,
      status: this.mapStatus(payload.status),
      // Deliberately absent: iPayMoney states no amount here. Filling it in
      // from our own records would be us corroborating ourselves.
      raw: payload,
    };
  }

  /**
   * The webhook, treated as a NOTIFICATION and never as evidence.
   *
   * WHY, because this is the most important decision in the adapter.
   *
   * iPayMoney's documented authentication is not a signature. The prose names
   * an `x-iPayMoney-secret` header carrying "une signature" (L332); the example
   * shows a `secret-hash` header whose value is `sk_58951...` (L338); and the
   * setup instructions say to paste your API secret into the dashboard's
   * "Secret Hash" field. Read together that is a STATIC SHARED SECRET echoed
   * back to us, and a constant header does not cover the request body. Anyone
   * holding it could forge any event, for any payment, with any status — and
   * because iPayMoney sends no amount either, nothing downstream would catch
   * it. The secret also travels on every one of the up-to-five retry
   * deliveries (L329), so a single appearance in a proxy log or an error report
   * is a permanent forgery capability.
   *
   * So the notification is not believed. It is checked, and then IGNORED as a
   * source of truth:
   *
   *   1. the secret header is compared in constant time — cheap, and it stops
   *      an unauthenticated party from making us issue arbitrary lookups;
   *   2. the body is parsed only to learn WHICH payment is being talked about;
   *   3. the status is then re-read from `GET /api/v1/payments/{reference}`,
   *      over our own TLS connection, authenticated with our Bearer key;
   *   4. the returned event carries the CONFIRMED status, never the claimed one.
   *
   * Forging a notification therefore buys nothing. It can make Afrinext ask
   * iPayMoney a question; it cannot make iPayMoney give the wrong answer. That
   * is strictly stronger than the scheme the documentation describes, and it
   * holds even if the secret leaks.
   *
   * WHAT IT COSTS. Verification now depends on iPayMoney's API being
   * reachable. When the lookup fails this throws, the route answers non-2xx,
   * and iPayMoney retries — which is the correct outcome: an unconfirmable
   * notification must not be treated as a confirmation, and the event is not
   * lost. It also does not fix the missing amount (question K8): the status
   * endpoint states no amount either, so the boundary's amount cross-check
   * still cannot run for this provider.
   *
   * Question K7 remains open. If iPayMoney confirms a real body signature, the
   * lookup becomes an optimisation rather than the safety property, and this
   * method can be simplified on evidence.
   */
  async verifyWebhook(rawBody: Buffer, headers: HeadersLike): Promise<VerifiedEvent> {
    const secret = this.webhookSecret;
    if (secret === undefined || secret === "") {
      throw new ProviderNotConfiguredError(
        this.id,
        "no webhook secret is configured. Set IPAYMONEY_WEBHOOK_SECRET (or the " +
          "API key, which the documentation says is the same value). Accepting " +
          "an unauthenticated notification is not an option.",
      );
    }

    /*
     * Both documented header names are accepted, because the documentation
     * contradicts itself about which one is sent and guessing wrong would
     * reject every real webhook. Accepting either is not a weakening: the
     * VALUE still has to match, and the value is the whole check.
     */
    const presented =
      headers.get("secret-hash") ??
      headers.get("x-ipaymoney-secret") ??
      headers.get("x-iPayMoney-secret");

    if (presented === null || presented === undefined) {
      throw new ProviderNotConfiguredError(
        this.id,
        "the webhook carried neither secret-hash nor x-iPayMoney-secret.",
      );
    }

    // Constant time, with the length compared first because timingSafeEqual
    // throws on a mismatch and the length of a secret is not the secret.
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(secret, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ProviderNotConfiguredError(
        this.id,
        "the webhook secret does not match.",
      );
    }

    /*
     * Parsed ONLY to learn which payment this is about.
     *
     * Nothing else in the body is trusted — not the status, not the msisdn, not
     * the external_reference. They are kept in `raw` so the record shows what
     * was claimed alongside what was confirmed, which is what makes a forgery
     * attempt visible after the fact.
     */
    let notification: { data?: Record<string, unknown> } | Record<string, unknown>;
    try {
      notification = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new ProviderNotConfiguredError(
        this.id,
        "the webhook body is not JSON.",
      );
    }

    const data = (
      (notification as { data?: Record<string, unknown> }).data ??
      (notification as Record<string, unknown>)
    );
    const claimedReference = data["reference"];
    if (typeof claimedReference !== "string" || claimedReference === "") {
      throw new ProviderNotConfiguredError(
        this.id,
        "the webhook names no payment reference, so there is nothing to confirm.",
      );
    }

    /*
     * The authoritative step. If this throws — unreachable, 5xx, unknown status
     * — nothing is confirmed and the caller answers non-2xx so iPayMoney
     * retries. An unconfirmable notification is not a confirmation.
     */
    const confirmed = await this.getCharge(claimedReference);

    return {
      subject: "charge",
      /*
       * Derived, because iPayMoney sends no event id and retries five times, so
       * duplicates are certain. See `ipaymoneyEventId` for why this exact shape
       * is safe.
       */
      providerEventId: ipaymoneyEventId(confirmed.providerRef, confirmed.status),
      type: `payment.${confirmed.status}`,
      providerRef: confirmed.providerRef,
      // The CONFIRMED status. The notification's claim never reaches here.
      status: confirmed.status,
      // Absent: iPayMoney states no amount in either channel. See K8.
      raw: {
        confirmed: confirmed.raw,
        // Screened, because a notification is attacker-influenced input and
        // this is stored.
        claimed: screenDetail(data).slice(0, 500),
      },
    };
  }

  /**
   * NOT IMPLEMENTED, and not because the documentation is thin.
   *
   * There is NO customer-refund operation in the iPayMoney documentation at
   * all: no endpoint, no method, no request body, no response, no status, no
   * webhook, no sandbox scenario, no fee and no processing time. The two
   * endpoints that exist are both on `/api/v1/payments`.
   *
   * « Remboursement » appears throughout the document and never means this. It
   * means REVERSEMENT — the merchant withdrawing their own balance to their own
   * mobile-money or bank account, with a 50 000 FCFA floor and a three-day
   * holding rule. Building a customer refund on top of it would return the
   * merchant's money to the merchant while a buyer waits.
   *
   * This stays throwing until iPayMoney confirms an actual customer-refund
   * capability — questions K1 and K5.
   */
  async refund(_input: RefundInput): Promise<RefundResult> {
    throw new ProviderNotConfiguredError(
      this.id,
      "iPayMoney documents no customer-refund API. The documented « reversement » " +
        "is the merchant withdrawing their own holdings and is not a refund. " +
        "Refusing rather than sending money somewhere the documentation does not " +
        "describe. See questions K1 and K5.",
    );
  }

  /**
   * Also not implemented, and declared rather than absent — the same reasoning
   * as before the documentation arrived.
   *
   * Omitting it would assert that iPayMoney has no refund-query capability, and
   * `supportsRefundQuery()` returning false makes every ambiguous refund a
   * manual process BY DESIGN. That happens to be the operational reality today,
   * but it should be true because iPayMoney said so, not because this file
   * decided it. Question K2.
   */
  async getRefund(_query: RefundQuery): Promise<RefundStatus> {
    throw new ProviderNotConfiguredError(
      this.id,
      "iPayMoney documents no way to query a refund, because it documents no " +
        "refund. The documented GET is a PAYMENT status endpoint and is not one. " +
        "See question K2.",
    );
  }

  // createPayout and getPayout stay absent. The documented reversement is a
  // dashboard-configured withdrawal of the merchant's own balance, on a period
  // or threshold schedule — not a disbursement API, and not a way to pay a
  // third party. Declaring the methods would assert a capability the
  // documentation does not describe.
}
