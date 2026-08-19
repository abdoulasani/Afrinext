import { ProviderNotConfiguredError } from "../errors";
import type {
  ChargeInput, ChargeResult, ChargeStatus, HeadersLike,
  PaymentProvider, RefundInput, RefundResult, VerifiedEvent,
} from "./provider";

/**
 * iPayMoney adapter — BOUNDARY ONLY. NOT IMPLEMENTED.
 *
 * iPayMoney is the confirmed initial payment provider and Afrinext holds a
 * merchant account. The official API documentation is not in this repository
 * and the provider's domain is not reachable from the build environment, so
 * nothing about their API has been verified: not the authentication scheme,
 * not an endpoint, not a payload, not a webhook signature.
 *
 * Every method therefore throws. That is deliberate. A stub that returned
 * plausible-looking data would let the rest of the system appear to work and
 * fail in production, on money.
 *
 * To implement, the following are required from the official documentation:
 *   1.  base URLs, sandbox and production
 *   2.  authentication scheme and credential placement
 *   3.  charge request/response schema and channels per country
 *   4.  flow type (hosted redirect, inline widget, JS SDK, USSD push)
 *   5.  status query endpoint and the complete status enumeration
 *   6.  webhook payload, signature algorithm, header name, timestamp tolerance
 *   7.  currency handling — specifically whether XOF is sent as whole francs
 *   8.  whether a payout/disbursement API exists, and settlement timing
 *   9.  refund API and constraints
 *   10. idempotency support and rate limits
 *   11. settlement schedule (T+N) and fees
 *   12. sandbox credentials and test accounts per channel
 *   13. JavaScript and Android SDK documentation, if the SDK route is used
 *
 * Drop the documentation into docs/providers/ipaymoney/ and this file can be
 * written against verified facts.
 */
const MISSING =
  "the official iPayMoney API documentation is not available in this repository. " +
  "See docs/providers/ipaymoney/README.md for exactly what is required. " +
  "No endpoint, payload or signature scheme has been invented in its place.";

export class IPayMoneyProvider implements PaymentProvider {
  readonly id = "ipaymoney";
  readonly isConfigured = false;

  private refuse(operation: string): never {
    throw new ProviderNotConfiguredError(this.id, `${operation} cannot run because ${MISSING}`);
  }

  async createCharge(_input: ChargeInput): Promise<ChargeResult> {
    this.refuse("createCharge");
  }

  async getCharge(_providerRef: string): Promise<ChargeStatus> {
    this.refuse("getCharge");
  }

  async verifyWebhook(_rawBody: Buffer, _headers: HeadersLike): Promise<VerifiedEvent> {
    this.refuse("verifyWebhook");
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    this.refuse("refund");
  }

  // createPayout and getPayout are intentionally absent: whether iPayMoney
  // offers disbursement at all is item 8 on the list above, and declaring the
  // methods would assert an answer we do not have.
}
