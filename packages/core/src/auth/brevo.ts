import { DomainError } from "../errors";
import { logger } from "../observability";
import { maskEmail } from "./email-identity";
import type { EmailMessage, EmailSender } from "./messaging";

const log = logger.child({ component: "auth.email.brevo" });

/**
 * Brevo's transactional email API, and nothing beyond what its own SDK does.
 *
 * ---------------------------------------------------------------------------
 * Where this contract comes from
 * ---------------------------------------------------------------------------
 *
 * Not from memory and not from a blog post. `developers.brevo.com` and
 * `api.brevo.com` are both unreachable from the environment this was written
 * in, so the endpoint, the header name, the body field names and the retry
 * semantics below were read out of Brevo's own published PHP SDK
 * (`github.com/getbrevo/brevo-php`, SDK 5.0.2, commit 1b371f9) — code Brevo
 * generates from its own specification:
 *
 *   - base URL         `src/Environments.php`
 *   - path and method  `src/TransactionalEmails/TransactionalEmailsClient.php`
 *   - `api-key` header `src/Brevo.php`
 *   - body fields      `.../Requests/SendTransacEmailRequest.php`
 *   - response fields  `.../Types/SendTransacEmailResponse.php`
 *   - error shape      `src/Types/ErrorModel.php`
 *
 * Anything the SDK does not state is not guessed here. In particular the exact
 * success status code is not asserted — the SDK treats 2xx and 3xx alike — and
 * neither is the body of a 401, because neither is written down anywhere I
 * could read. **No request has ever been sent to Brevo from this codebase.**
 * The first proof that a real account accepts these requests comes from the
 * preview deployment, and the milestone note says so.
 */
export const BREVO_BASE_URL = "https://api.brevo.com/v3";

/** Brevo caps a display name at 70 characters, for the sender and each recipient. */
export const BREVO_NAME_MAX_LENGTH = 70;

/**
 * The SDK configures no default timeout and says so. An HTTP call with no
 * timeout inside the signup path is a hung request holding a person on a
 * spinner for as long as the socket stays open, so one is required here rather
 * than optional.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface BrevoConfig {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly replyToEmail?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /**
   * Overridden ONLY by tests, which point it at a local server.
   *
   * Not a way to reach a different provider: everything below is Brevo's
   * contract, so a different host would have to speak Brevo anyway.
   */
  readonly baseUrl?: string | undefined;
}

export class EmailNotConfiguredError extends DomainError {
  override readonly name = "EmailNotConfiguredError";
  constructor(missing: string) {
    super(
      "email.not_configured",
      `The email provider is selected but ${missing}. Refusing to start rather ` +
        "than silently dropping every verification code.",
    );
  }
}

/**
 * What a caller — and therefore a screen — is told when delivery fails.
 *
 * Deliberately carries nothing from the provider's response.
 *
 * The object-storage milestone shipped an error that embedded the provider's
 * body into a message rendered on a seller's screen, and that was a real leak
 * found by a test. The same mistake is easier here, because the thing being
 * sent IS a secret: `EmailMessage.body` holds the verification code. So the
 * message is fixed text, the diagnosis goes to the log, and nothing that
 * touched the code or the key is allowed into either.
 */
export class EmailDeliveryFailedError extends DomainError {
  override readonly name = "EmailDeliveryFailedError";
  constructor() {
    super(
      "email.delivery_failed",
      "The message could not be sent. Please try again.",
    );
  }
}

interface BrevoErrorBody {
  readonly code?: string;
  readonly message?: string;
}

export class BrevoSender implements EmailSender {
  readonly id = "brevo";

  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly replyToEmail: string | undefined;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(config: BrevoConfig) {
    if (config.apiKey === "") throw new EmailNotConfiguredError("no API key is set");
    if (config.fromEmail === "") throw new EmailNotConfiguredError("no sender address is set");
    if (config.fromName === "") throw new EmailNotConfiguredError("no sender name is set");
    /*
     * Checked here, not left to Brevo.
     *
     * The limit is theirs — 70 characters, from the SDK's own field
     * documentation — but a rejection discovered at send time is a
     * verification code that silently never arrives, for every account, until
     * somebody reads the log. A configuration mistake belongs at construction,
     * where it stops the process from starting.
     */
    if (config.fromName.length > BREVO_NAME_MAX_LENGTH) {
      throw new EmailNotConfiguredError(
        `the sender name is ${config.fromName.length} characters and Brevo allows ` +
          `${BREVO_NAME_MAX_LENGTH}`,
      );
    }

    this.apiKey = config.apiKey;
    this.fromEmail = config.fromEmail;
    this.fromName = config.fromName;
    this.replyToEmail = config.replyToEmail === "" ? undefined : config.replyToEmail;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.endpoint = `${(config.baseUrl ?? BREVO_BASE_URL).replace(/\/+$/, "")}/smtp/email`;
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    /*
     * `textContent` AND `htmlContent`.
     *
     * Our messages are one line of text, so the HTML part carries the same
     * words in a paragraph rather than a design. It is there because a
     * multipart message is treated better by spam filters than a text-only
     * one, and a verification code that lands in a spam folder is
     * indistinguishable from a code that was never sent — which is precisely
     * the failure this milestone exists to end.
     */
    const body: Record<string, unknown> = {
      sender: { email: this.fromEmail, name: this.fromName },
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.body,
      htmlContent: `<p>${escapeHtml(message.body)}</p>`,
    };
    // Omitted entirely when unset: Brevo requires `replyTo.email` only if the
    // object is present at all.
    if (this.replyToEmail !== undefined) body["replyTo"] = { email: this.replyToEmail };
    if (message.idempotencyKey !== undefined) {
      body["headers"] = { "Idempotency-Key": message.idempotencyKey };
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          // The exact header name, lower-case, from `src/Brevo.php`. Not
          // `Authorization`, not a bearer token.
          "api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause: unknown) {
      /*
       * A timeout or a transport failure. The name is recorded and the error
       * object is NOT: a fetch failure can carry the request, and the request
       * carries the code.
       */
      log.error("brevo request failed", {
        reason: cause instanceof Error ? cause.name : "unknown",
        to: maskEmail(message.to),
        timeoutMs: this.timeoutMs,
      });
      throw new EmailDeliveryFailedError();
    }

    // The SDK treats 200-399 as success and does not name a single code, so
    // neither does this.
    if (response.status >= 200 && response.status < 400) return;

    const detail = await readErrorBody(response);
    log.error("brevo refused the message", {
      status: response.status,
      // Brevo's own `code` and `message` from `ErrorModel`. They describe the
      // request's fault, never its contents — and they are the only two fields
      // read, so an unexpected field cannot smuggle anything into the log.
      brevoCode: detail.code ?? null,
      brevoMessage: detail.message ?? null,
      to: maskEmail(message.to),
    });
    throw new EmailDeliveryFailedError();
  }
}

/** Brevo's `ErrorModel`: `code` and `message`, and nothing else is read. */
async function readErrorBody(response: Response): Promise<BrevoErrorBody> {
  try {
    const parsed: unknown = await response.json();
    if (parsed === null || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record["code"] === "string" ? { code: record["code"] } : {}),
      ...(typeof record["message"] === "string" ? { message: record["message"] } : {}),
    };
  } catch {
    return {};
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
