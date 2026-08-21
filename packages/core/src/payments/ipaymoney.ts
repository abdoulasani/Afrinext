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
 * What it does NOT establish, and what therefore still throws:
 *
 *   verifyWebhook()  the authentication scheme is ambiguous and, on the most
 *                    likely reading, is a static shared secret echoed in a
 *                    header rather than a signature over the body. See the
 *                    method for the full argument. Implementing it as
 *                    documented would mean a check that does not cover the
 *                    payload, which is not a webhook boundary at all.
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
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IPayMoneyOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env["IPAYMONEY_BASE_URL"] ?? DEFAULT_BASE_URL)
      .replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? process.env["IPAYMONEY_API_KEY"];
    this.environment = options.environment ?? process.env["IPAYMONEY_ENVIRONMENT"];
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
   * NOT IMPLEMENTED, and the reason is a security decision rather than effort.
   *
   * The documentation describes webhook authentication three times and the
   * three do not agree:
   *
   *   L332  "Il est introduit dans l'en-tête de chaque requête
   *          x-iPayMoney-secret une signature"          → a header named
   *                                                       x-iPayMoney-secret,
   *                                                       carrying "a signature"
   *   L338  "secret-hash": "sk_58951rhguiq859905dfn5903gh"
   *                                                     → a DIFFERENT header
   *                                                       name, carrying what
   *                                                       looks like the secret
   *                                                       key itself
   *   setup "Remplissez votre Secret Hash. C'est votre clé API secrète"
   *                                                     → the merchant pastes
   *                                                       their API secret into
   *                                                       the dashboard field
   *
   * Read together, the most likely meaning is that iPayMoney echoes a STATIC
   * SHARED SECRET back in a header. If that is what it is, then:
   *
   *   - the check does not cover the request body at all, so anyone who holds
   *     the secret can forge any event, with any status, for any payment;
   *   - the secret is transmitted on every delivery — and iPayMoney retries
   *     five times (L329) — so one observation in a proxy log, an error report
   *     or a request dump is a permanent forgery capability;
   *   - combined with there being no amount in the payload, a forged event
   *     would face no amount cross-check either.
   *
   * An HMAC over the raw bytes gives an attacker holding the secret the same
   * forging power, so the difference is not the algorithm's strength — it is
   * that an HMAC never transmits the key and binds the header to the body.
   *
   * Afrinext's webhook boundary verifies a signature over the raw bytes before
   * parsing, and that property is load-bearing: it is why a forged amount
   * cannot confirm a payment. Implementing a constant-header check here would
   * satisfy the type signature while removing the property, and a verification
   * function that does not verify is worse than one that refuses.
   *
   * So it refuses, and iPayMoney is asked (question K7) whether a body
   * signature is available. See docs/providers/ipaymoney/support-questions.md.
   */
  async verifyWebhook(_rawBody: Buffer, _headers: HeadersLike): Promise<VerifiedEvent> {
    throw new ProviderNotConfiguredError(
      this.id,
      "the webhook authentication scheme is not established. The documentation " +
        "names the header x-iPayMoney-secret in prose and secret-hash in its " +
        "example, whose value is the API secret itself — a static shared secret " +
        "echoed in a header does not cover the request body, so it is not a " +
        "signature. Confirm with iPayMoney (question K7) before any webhook is " +
        "trusted to confirm money.",
    );
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
