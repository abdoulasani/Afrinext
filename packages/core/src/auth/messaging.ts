/**
 * Delivery is an interface, not a provider.
 *
 * No SMS or email provider has been chosen for Niger yet, and the OTP flow must
 * not be built around whichever one is picked. `ConsoleSender` keeps development
 * and tests working without an account anywhere, and refuses to run in
 * production so a missing provider fails loudly instead of silently dropping
 * every verification code.
 */
export interface SmsMessage {
  readonly to: string;
  readonly body: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /**
   * A key the provider may use to collapse a retried send into one delivery.
   *
   * Optional, and the caller supplies the natural identifier rather than
   * inventing one: a code's challenge id. The case it exists for is a send
   * whose response is lost after the request left this process — the same
   * shape of doubt the refund policy is built around. Without it, the retry
   * puts a second code in somebody's inbox and the first one still works,
   * which is confusing at best.
   *
   * A sender that has no such feature ignores it. `ConsoleSender` does.
   */
  readonly idempotencyKey?: string | undefined;
}

/**
 * Delivery, split by channel — because an SMS and an email are two products.
 *
 * They were one interface while nothing implemented either, and that was fine
 * until a real email provider arrived. Brevo sends email for Afrinext; no SMS
 * provider has been chosen, and none may be assumed. A single `MessageSender`
 * would have forced the email adapter to answer for `sendSms` too, and the
 * only honest answer it could give is a throw — which would take the phone
 * sign-in flow down with it, in production, on the launch path in Niger.
 *
 * So the interface splits along the line the products already split along, and
 * `MessageSender` stays exactly what every existing call site expects: both
 * halves at once. `CompositeSender` is how the two are paired.
 */
export interface EmailSender {
  readonly id: string;
  sendEmail(message: EmailMessage): Promise<void>;
}

export interface SmsSender {
  readonly id: string;
  sendSms(message: SmsMessage): Promise<void>;
}

export interface MessageSender extends EmailSender, SmsSender {
  readonly id: string;
}

/**
 * One `MessageSender` made of two independent channel senders.
 *
 * The id names both, e.g. `email:brevo/sms:console`, so an audit row says
 * which sender actually carried the message rather than naming a bundle. That
 * is more than the single id recorded before, and it is exactly the question
 * asked when somebody reports that a code never arrived.
 */
export class CompositeSender implements MessageSender {
  readonly id: string;

  constructor(
    private readonly email: EmailSender,
    private readonly sms: SmsSender,
  ) {
    this.id = `email:${email.id}/sms:${sms.id}`;
  }

  sendEmail(message: EmailMessage): Promise<void> {
    return this.email.sendEmail(message);
  }

  sendSms(message: SmsMessage): Promise<void> {
    return this.sms.sendSms(message);
  }
}

export class ConsoleSender implements MessageSender {
  readonly id = "console";
  private readonly sent: (SmsMessage | EmailMessage)[] = [];
  private readonly echo: boolean;

  constructor() {
    // No SMS provider has been chosen for Niger yet, so this is what runs. It
    // must never be what runs in front of real users: a verification code that
    // goes to a log file is a verification code an attacker can read.
    //
    // NODE_ENV alone is the wrong test — `next start` sets it to "production"
    // for an ordinary local smoke run too. So the refusal is explicit, with the
    // same opt-out shape the destructive database reset uses: you have to say
    // out loud that you meant it.
    if (process.env["NODE_ENV"] === "production" && process.env["ALLOW_CONSOLE_SENDER"] !== "yes") {
      throw new Error(
        "ConsoleSender refuses to run with NODE_ENV=production: verification " +
          "codes would be written to the log instead of delivered. Configure a " +
          "real SMS provider, or set ALLOW_CONSOLE_SENDER=yes for a local " +
          "production-mode smoke test only.",
      );
    }

    // Tests read the outbox through `lastCodeTo`. A running server has no such
    // handle, and since the code is now only ever stored as a hash there is
    // nowhere else to find it — so a developer signing in locally needs it
    // written out. That is exactly what must never happen in front of real
    // users, which is why it is tied to the same explicit opt-in and announces
    // itself every time.
    this.echo = process.env["NODE_ENV"] !== "test" && process.env["VITEST"] === undefined;
  }

  private record(message: SmsMessage | EmailMessage, printable: string): void {
    this.sent.push(message);
    if (this.echo) {
      // Deliberately not the structured logger: this is a development aid, not
      // an event worth shipping to a log store, and the logger redacts by key
      // name anyway.
      console.warn(`[ConsoleSender] NOT DELIVERED — would send to ${message.to}: ${printable}`);
    }
  }

  sendSms(message: SmsMessage): Promise<void> {
    this.record(message, message.body);
    return Promise.resolve();
  }

  sendEmail(message: EmailMessage): Promise<void> {
    this.record(message, `${message.subject} / ${message.body}`);
    return Promise.resolve();
  }

  /** Test helper: what would have been delivered. */
  outbox(): readonly (SmsMessage | EmailMessage)[] {
    return this.sent;
  }

  lastCodeTo(recipient: string): string | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const message = this.sent[i];
      if (message !== undefined && message.to === recipient) {
        return /(\d{4,8})/.exec(message.body)?.[1];
      }
    }
    return undefined;
  }
}
