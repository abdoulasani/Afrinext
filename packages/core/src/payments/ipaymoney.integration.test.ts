import { describe, expect, it } from "vitest";
import { IPayMoneyProvider } from "./ipaymoney";

/**
 * Integration tests against the real iPayMoney sandbox.
 *
 * Skipped unless sandbox credentials are present, so CI is green without them
 * and turns red the moment a real sandbox run regresses. They are written
 * against the documented API — see docs/providers/ipaymoney/README.md — and
 * cannot be filled in until that documentation exists.
 */
const hasSandbox =
  typeof process.env["IPAYMONEY_BASE_URL"] === "string" &&
  typeof process.env["IPAYMONEY_API_KEY"] === "string";

describe.skipIf(!hasSandbox)("iPayMoney sandbox", () => {
  it("creates a charge", () => {
    // NOT IMPLEMENTED — requires items 1-3 of the documentation checklist.
    expect(new IPayMoneyProvider().isConfigured).toBe(true);
  });

  it("verifies a webhook signature", () => {
    // NOT IMPLEMENTED — requires item 6 (signature algorithm and header name).
    expect.fail("Webhook verification cannot be tested until the scheme is documented.");
  });

  it("reports whether disbursement is supported", () => {
    // NOT IMPLEMENTED — requires item 8.
    expect.fail("Payout support is unknown until the documentation confirms it.");
  });
});

describe("iPayMoney sandbox availability", () => {
  it("is skipped without credentials, and says so", () => {
    // This assertion documents the gate itself, so a reader of the test output
    // can tell "skipped" from "passed".
    expect(hasSandbox).toBe(false);
  });
});
