import { describe, expect, it } from "vitest";
import { BrevoSender, EmailNotConfiguredError } from "./brevo";
import { CompositeSender, ConsoleSender } from "./messaging";
import { selectEmailSender, selectMessageSender, selectSmsSender } from "./select-sender";

/**
 * Which sender each channel gets.
 *
 * A pure function of `env`, so every branch is reachable without touching
 * `process.env` — including the production branches, which is the whole point:
 * the refusals that only fire in production are the ones nobody exercises by
 * accident, and they are the ones that decide whether verification codes go to
 * real inboxes or to a log file.
 */

const BREVO_ENV = {
  EMAIL_PROVIDER: "brevo",
  EMAIL_BREVO_API_KEY: "xkeysib-not-a-real-credential",
  EMAIL_FROM: "no-reply@afrinext.example",
  EMAIL_FROM_NAME: "Afrinext",
} as const;

describe("choosing the email sender", () => {
  it("defaults to the console sender when nothing is configured", () => {
    expect(selectEmailSender({}).id).toBe("console");
  });

  it("builds a Brevo sender when the provider is named and configured", () => {
    const sender = selectEmailSender(BREVO_ENV);
    expect(sender).toBeInstanceOf(BrevoSender);
    expect(sender.id).toBe("brevo");
  });

  it("refuses a provider name it does not implement", () => {
    /*
     * A typo must not fall back. `EMAIL_PROVIDER=brevoo` quietly selecting the
     * console sender is the same silent-fallback defect the storage selector
     * refuses — and here it would mean every code in production going to a log
     * file while the deployment looked healthy.
     */
    expect(() => selectEmailSender({ EMAIL_PROVIDER: "brevoo" }))
      .toThrow(EmailNotConfiguredError);
    expect(() => selectEmailSender({ EMAIL_PROVIDER: "sendgrid" }))
      .toThrow(/names no adapter/);
  });

  it("names every missing variable rather than failing on the first", () => {
    const failure = (() => {
      try { selectEmailSender({ EMAIL_PROVIDER: "brevo" }); return ""; }
      catch (e: unknown) { return (e as Error).message; }
    })();

    // An operator setting this up for the first time should learn all three in
    // one deploy, not one per deploy.
    expect(failure).toContain("EMAIL_BREVO_API_KEY");
    expect(failure).toContain("EMAIL_FROM");
    expect(failure).toContain("EMAIL_FROM_NAME");
  });

  it("treats an empty string as unset", () => {
    // Render writes an empty value for a variable somebody added and never
    // filled in, and "" is not a usable API key.
    expect(() => selectEmailSender({ ...BREVO_ENV, EMAIL_BREVO_API_KEY: "" }))
      .toThrow(/EMAIL_BREVO_API_KEY/);
  });

  it("passes the reply-to through when set, and omits it when not", () => {
    // Observable only through the request, which brevo.test.ts asserts; here
    // it is enough that neither shape is refused at construction.
    expect(() => selectEmailSender({ ...BREVO_ENV, EMAIL_REPLY_TO: "contact@afrinext.example" }))
      .not.toThrow();
    expect(() => selectEmailSender({ ...BREVO_ENV, EMAIL_REPLY_TO: "" })).not.toThrow();
  });

  it("refuses a sender name Brevo would reject", () => {
    expect(() => selectEmailSender({ ...BREVO_ENV, EMAIL_FROM_NAME: "x".repeat(71) }))
      .toThrow(/70/);
  });
});

describe("the console sender still refuses production without being told", () => {
  it("throws under NODE_ENV=production unless the opt-out is explicit", () => {
    const previousNodeEnv = process.env["NODE_ENV"];
    const previousAllow = process.env["ALLOW_CONSOLE_SENDER"];
    try {
      process.env["NODE_ENV"] = "production";
      delete process.env["ALLOW_CONSOLE_SENDER"];

      /*
       * The refusal lives in ConsoleSender's constructor and is deliberately
       * not repeated in the selector: one refusal, in the place that can also
       * be reached directly. This asserts the selector does not somehow route
       * around it.
       */
      expect(() => selectEmailSender({})).toThrow(/ALLOW_CONSOLE_SENDER/);
      expect(() => selectEmailSender({ EMAIL_PROVIDER: "console" }))
        .toThrow(/ALLOW_CONSOLE_SENDER/);

      process.env["ALLOW_CONSOLE_SENDER"] = "yes";
      expect(selectEmailSender({}).id).toBe("console");
    } finally {
      if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previousNodeEnv;
      if (previousAllow === undefined) delete process.env["ALLOW_CONSOLE_SENDER"];
      else process.env["ALLOW_CONSOLE_SENDER"] = previousAllow;
    }
  });
});

describe("the SMS channel", () => {
  it("is the console sender, because no SMS provider has been chosen", () => {
    // Not an oversight and not a placeholder for Brevo: Brevo's SMS product
    // was not audited and is not assumed. When one is chosen this function is
    // where it arrives.
    expect(selectSmsSender({}).id).toBe("console");
    expect(selectSmsSender(BREVO_ENV).id).toBe("console");
  });

  it("is unaffected by the email provider, so phone sign-in cannot break", () => {
    /*
     * The reason the interface was split at all. A single sender would have
     * forced the Brevo adapter to answer for `sendSms`, and the only honest
     * answer is a throw — which would take phone sign-in down in production,
     * on the launch path in Niger.
     */
    const sender = selectMessageSender(BREVO_ENV);
    expect(sender.id).toBe("email:brevo/sms:console");
  });
});

describe("the composite", () => {
  it("routes each channel to its own sender", async () => {
    const email = new ConsoleSender();
    const sms = new ConsoleSender();
    const composite = new CompositeSender(email, sms);

    await composite.sendEmail({ to: "a@b.co", subject: "s", body: "b" });
    await composite.sendSms({ to: "+22790000001", body: "b" });

    expect(email.outbox()).toHaveLength(1);
    expect(sms.outbox()).toHaveLength(1);
    expect(email.outbox()[0]).toMatchObject({ to: "a@b.co" });
    expect(sms.outbox()[0]).toMatchObject({ to: "+22790000001" });
  });

  it("names both senders in its id, so an audit row says which one carried it", () => {
    const composite = new CompositeSender(
      { id: "brevo", sendEmail: () => Promise.resolve() },
      { id: "console", sendSms: () => Promise.resolve() },
    );
    expect(composite.id).toBe("email:brevo/sms:console");
  });

  it("keeps satisfying MessageSender, so no existing call site changes", () => {
    const composite = selectMessageSender({});
    expect(typeof composite.sendEmail).toBe("function");
    expect(typeof composite.sendSms).toBe("function");
    expect(typeof composite.id).toBe("string");
  });
});
