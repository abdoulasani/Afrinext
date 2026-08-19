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
}

export interface MessageSender {
  readonly id: string;
  sendSms(message: SmsMessage): Promise<void>;
  sendEmail(message: EmailMessage): Promise<void>;
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
