import { BrevoSender, EmailNotConfiguredError } from "./brevo";
import { CompositeSender, ConsoleSender, type EmailSender, type MessageSender, type SmsSender } from "./messaging";

export interface SenderEnv {
  readonly [key: string]: string | undefined;
}

/**
 * Which sender each channel gets, decided in one place, from configuration.
 *
 * Shaped after `selectContentStorage`, and for the same three reasons that one
 * exists: an unknown adapter name throws rather than defaulting, a production
 * environment cannot get the development adapter by accident, and the decision
 * is a pure function of `env` so a test can drive every branch without
 * touching `process.env`.
 *
 * ---------------------------------------------------------------------------
 * Why the two channels are chosen separately
 * ---------------------------------------------------------------------------
 *
 * `EMAIL_PROVIDER` selects the email sender only. **No SMS provider has been
 * chosen**, so the SMS half is `ConsoleSender` in every environment — and
 * `ConsoleSender` refuses to run under `NODE_ENV=production` unless
 * `ALLOW_CONSOLE_SENDER=yes` says out loud that codes going to a log is
 * deliberate. That refusal is unchanged and is what keeps this from being the
 * silent fallback it must never be.
 *
 * The consequence is worth stating plainly, because it is a real operational
 * constraint rather than an implementation detail: a production deployment
 * that wants real email AND phone sign-in must still set
 * `ALLOW_CONSOLE_SENDER=yes`, because its SMS codes are still going nowhere.
 * That stops being true the day an SMS provider is chosen, and not before.
 */
export function selectEmailSender(env: SenderEnv): EmailSender {
  const selected = env["EMAIL_PROVIDER"] ?? "console";

  if (selected === "brevo") {
    const missing = ([
      ["EMAIL_BREVO_API_KEY", env["EMAIL_BREVO_API_KEY"]],
      ["EMAIL_FROM", env["EMAIL_FROM"]],
      ["EMAIL_FROM_NAME", env["EMAIL_FROM_NAME"]],
    ] as const).filter(([, value]) => value === undefined || value === "").map(([name]) => name);

    if (missing.length > 0) {
      throw new EmailNotConfiguredError(
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`,
      );
    }

    return new BrevoSender({
      apiKey: env["EMAIL_BREVO_API_KEY"] ?? "",
      fromEmail: env["EMAIL_FROM"] ?? "",
      fromName: env["EMAIL_FROM_NAME"] ?? "",
      // Optional at our level. Unset means the field is left out entirely.
      ...(env["EMAIL_REPLY_TO"] !== undefined && env["EMAIL_REPLY_TO"] !== ""
        ? { replyToEmail: env["EMAIL_REPLY_TO"] }
        : {}),
    });
  }

  if (selected !== "console") {
    /*
     * A typo is not a reason to fall back. Defaulting `EMAIL_PROVIDER=brevoo`
     * to the console sender is the same silent-fallback bug the storage
     * selector refuses, wearing a different hat — and here it would mean every
     * verification code in production going to a log file.
     */
    throw new EmailNotConfiguredError(
      `EMAIL_PROVIDER="${selected}" names no adapter; "console" and "brevo" are the two`,
    );
  }

  // ConsoleSender's own constructor is what refuses production. Deliberately
  // not repeated here: one refusal, in the place that can also be reached
  // directly.
  return new ConsoleSender();
}

/** No provider is chosen. This is the whole SMS story, and it is honest. */
export function selectSmsSender(_env: SenderEnv): SmsSender {
  return new ConsoleSender();
}

export function selectMessageSender(env: SenderEnv): MessageSender {
  return new CompositeSender(selectEmailSender(env), selectSmsSender(env));
}
