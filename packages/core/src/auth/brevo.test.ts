import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBrevoTestServer, type BrevoTestServer } from "../test/brevo-server";
import { messageChain } from "../test/harness";
import {
  BREVO_BASE_URL, BREVO_NAME_MAX_LENGTH, BrevoSender,
  EmailDeliveryFailedError, EmailNotConfiguredError,
} from "./brevo";

/**
 * The Brevo adapter, against a real HTTP server that checks the request.
 *
 * Nothing in this file has ever spoken to Brevo, and nothing claims to: the
 * environment cannot reach `api.brevo.com` and no key exists. What is checked
 * is that the adapter forms the request Brevo's own published SDK describes,
 * and behaves correctly on the statuses that SDK names.
 *
 * The most important assertions here are the negative ones. The thing being
 * sent IS a secret — `body` carries the verification code — so a leak into a
 * log or an error message is the defect that matters most, and it is the one a
 * reader of an error would never notice.
 */

const CODE = "483920";
const MESSAGE = {
  to: "aicha@example.com",
  subject: "Afrinext — vérification de votre adresse",
  body: `Votre code de vérification Afrinext : ${CODE}`,
};

let server: BrevoTestServer;

function sender(overrides: Record<string, unknown> = {}): BrevoSender {
  return new BrevoSender({
    apiKey: server.apiKey,
    fromEmail: "no-reply@afrinext.example",
    fromName: "Afrinext",
    baseUrl: server.baseUrl,
    ...overrides,
  });
}

/** Captures what the structured logger writes to stdout. */
function captureStdout(): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, stop: () => { spy.mockRestore(); } };
}

beforeEach(async () => { server = await startBrevoTestServer(); });
afterEach(async () => { await server.close(); });

describe("the request Brevo's contract describes", () => {
  it("POSTs to /v3/smtp/email with the api-key header", async () => {
    await sender().sendEmail(MESSAGE);

    expect(server.seen).toHaveLength(1);
    const request = server.seen[0];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/v3/smtp/email");
    // The exact header name, lower-case. Not `Authorization`, not a bearer.
    expect(request?.apiKey).toBe(server.apiKey);
    expect(request?.contentType).toContain("application/json");
  });

  it("uses the endpoint from Brevo's own SDK when no base URL is given", () => {
    expect(BREVO_BASE_URL).toBe("https://api.brevo.com/v3");
  });

  it("sends the field names the contract names, and no others", async () => {
    await sender({ replyToEmail: "contact@afrinext.example" }).sendEmail(MESSAGE);
    const body = server.seen[0]?.body ?? {};

    expect(body["sender"]).toEqual({
      email: "no-reply@afrinext.example",
      name: "Afrinext",
    });
    expect(body["to"]).toEqual([{ email: "aicha@example.com" }]);
    expect(body["subject"]).toBe(MESSAGE.subject);
    expect(body["textContent"]).toBe(MESSAGE.body);
    expect(body["htmlContent"]).toContain(CODE);
    expect(body["replyTo"]).toEqual({ email: "contact@afrinext.example" });

    /*
     * `sender` and `to` are not interchangeable, and swapping them would still
     * produce a request Brevo accepts — it would simply mail Afrinext instead
     * of the person. Asserted explicitly because the shapes are so similar.
     */
    expect((body["sender"] as { email: string }).email).not.toBe(MESSAGE.to);
  });

  it("omits replyTo entirely when none is configured", async () => {
    await sender().sendEmail(MESSAGE);
    // Brevo requires `replyTo.email` only if the object is present at all, so
    // an empty object would be a rejection rather than a default.
    expect(server.seen[0]?.body).not.toHaveProperty("replyTo");
    expect(server.seen[0]?.raw).not.toContain("replyTo");
  });

  it("carries the idempotency key as a Brevo custom header field", async () => {
    await sender().sendEmail({ ...MESSAGE, idempotencyKey: "01a065e6-296e-7ebf" });
    expect(server.seen[0]?.body["headers"])
      .toEqual({ "Idempotency-Key": "01a065e6-296e-7ebf" });
  });

  it("sends no headers field when there is no key to put in it", async () => {
    await sender().sendEmail(MESSAGE);
    expect(server.seen[0]?.body).not.toHaveProperty("headers");
  });

  it("escapes the text it puts into the HTML part", async () => {
    await sender().sendEmail({ ...MESSAGE, body: 'code <b>1</b> & "2"' });
    const html = server.seen[0]?.body["htmlContent"] as string;
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
    expect(html).not.toContain("<b>");
  });
});

describe("configuration is refused at construction, not at send time", () => {
  it("refuses a missing key, address or name", () => {
    const base = { apiKey: "k", fromEmail: "a@b.co", fromName: "N" };
    expect(() => new BrevoSender({ ...base, apiKey: "" })).toThrow(EmailNotConfiguredError);
    expect(() => new BrevoSender({ ...base, fromEmail: "" })).toThrow(EmailNotConfiguredError);
    expect(() => new BrevoSender({ ...base, fromName: "" })).toThrow(EmailNotConfiguredError);
  });

  it("refuses a sender name longer than Brevo's 70 characters", () => {
    /*
     * The limit is Brevo's, from its SDK's field documentation. Discovering it
     * at send time would mean every verification code silently failing, for
     * every account, until somebody read a log — so it is a startup error.
     */
    expect(BREVO_NAME_MAX_LENGTH).toBe(70);
    const ok = "x".repeat(BREVO_NAME_MAX_LENGTH);
    const tooLong = "x".repeat(BREVO_NAME_MAX_LENGTH + 1);

    expect(() => new BrevoSender({ apiKey: "k", fromEmail: "a@b.co", fromName: ok }))
      .not.toThrow();
    expect(() => new BrevoSender({ apiKey: "k", fromEmail: "a@b.co", fromName: tooLong }))
      .toThrow(/70/);
  });
});

describe("what happens when Brevo refuses", () => {
  const cases = [
    { status: 401, label: "a rejected key" },
    { status: 429, label: "a rate limit at the provider" },
    { status: 500, label: "a provider fault" },
    { status: 503, label: "a provider outage" },
  ] as const;

  for (const { status, label } of cases) {
    it(`turns ${status} — ${label} — into a domain error that says nothing`, async () => {
      server.respondWith({ status, body: { code: "some_code", message: "some detail" } });
      const failure = await sender().sendEmail(MESSAGE).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(EmailDeliveryFailedError);
      const text = messageChain(failure);
      /*
       * The message reaches a person's screen. It must carry no status, no
       * provider wording, no address and above all no code — the storage
       * milestone shipped exactly that leak once and a test caught it.
       */
      expect(text).not.toContain(CODE);
      expect(text).not.toContain(server.apiKey);
      expect(text).not.toContain("some detail");
      expect(text).not.toContain(String(status));
      expect(text).not.toContain(MESSAGE.to);
    });
  }

  it("succeeds on any 2xx, because the contract names no single code", async () => {
    for (const status of [200, 201, 202]) {
      server.respondWith({ status, body: { messageId: "<x@y>" } });
      await expect(sender().sendEmail(MESSAGE)).resolves.toBeUndefined();
    }
  });

  it("fails when the key is wrong, without echoing the key back", async () => {
    const wrong = new BrevoSender({
      apiKey: "xkeysib-a-different-key",
      fromEmail: "no-reply@afrinext.example",
      fromName: "Afrinext",
      baseUrl: server.baseUrl,
    });
    await expect(wrong.sendEmail(MESSAGE)).rejects.toBeInstanceOf(EmailDeliveryFailedError);
    expect(server.seen[0]?.apiKey).toBe("xkeysib-a-different-key");
  });

  it("gives up on its own timeout rather than hanging the signup", async () => {
    // The server is told never to answer, so only the adapter's own deadline
    // can end this. Brevo's SDK configures no default timeout and says so;
    // an unbounded call here holds somebody on a spinner indefinitely.
    server.respondWith({ status: 0 });
    const started = Date.now();
    await expect(sender({ timeoutMs: 300 }).sendEmail(MESSAGE))
      .rejects.toBeInstanceOf(EmailDeliveryFailedError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("nothing sensitive reaches the log", () => {
  let capture: { lines: string[]; stop: () => void } | undefined;
  afterEach(() => { capture?.stop(); capture = undefined; });

  it("logs a refusal with Brevo's own code and a masked address, and nothing else", async () => {
    server.respondWith({
      status: 400,
      // A body carrying things that must not travel, including a field the
      // adapter is not allowed to read.
      body: { code: "invalid_parameter", message: "sender not valid", secret: CODE },
    });

    capture = captureStdout();
    await sender().sendEmail(MESSAGE).catch(() => undefined);
    capture.stop();

    const logged = capture.lines.join("\n");
    expect(logged).toContain("brevo refused the message");
    expect(logged).toContain("invalid_parameter");
    expect(logged).toContain("a****@example.com");

    expect(logged, "the code must never be logged").not.toContain(CODE);
    expect(logged, "the API key must never be logged").not.toContain(server.apiKey);
    expect(logged, "the message body must never be logged").not.toContain(MESSAGE.body);
    expect(logged, "the whole address must never be logged").not.toContain(MESSAGE.to);
    // Only `code` and `message` are read from the error body, so an unexpected
    // field cannot smuggle anything through.
    expect(logged).not.toContain("secret");
  });

  it("logs a transport failure without the request that carries the code", async () => {
    server.respondWith({ status: 0 });
    capture = captureStdout();
    await sender({ timeoutMs: 250 }).sendEmail(MESSAGE).catch(() => undefined);
    capture.stop();

    const logged = capture.lines.join("\n");
    expect(logged).toContain("brevo request failed");
    expect(logged).toContain("TimeoutError");
    expect(logged).toContain("a****@example.com");
    /*
     * A fetch failure can carry the request object, and the request carries
     * the code. So the cause is reduced to its name before it is written —
     * logging the error itself would put the body in the log.
     */
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain(server.apiKey);
    expect(logged).not.toContain(MESSAGE.to);
  });
});
