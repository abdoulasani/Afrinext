# iPayMoney integration — what is missing

**Status: NOT IMPLEMENTED.** The adapter at
`packages/core/src/payments/ipaymoney.ts` is a boundary. Every method throws
`ProviderNotConfiguredError`. Nothing about the iPayMoney API has been verified.

## Why it is not implemented

iPayMoney is the confirmed initial payment provider and Afrinext holds a
merchant account. However:

- the official API documentation is **not in this repository**; and
- the provider's domain is **not reachable from the build environment** —
  outbound egress to it is blocked by the network policy.

So no endpoint, authentication scheme, payload, status value or webhook
signature has been confirmed. A stub returning plausible-looking data would let
the rest of the system appear to work and then fail in production, on money.
Throwing is the honest behaviour.

Capabilities reported by the business — Mobile Money, credit cards, local and
international cards, a JavaScript SDK and an Android SDK — are recorded here as
**stated, pending confirmation**. No code treats them as facts.

## What to put in this folder

Any form is fine: PDF, exported HTML, an OpenAPI/Swagger file, or a Postman
collection. Once the documentation is here, the adapter can be written against
verified facts.

## What the adapter needs before it can be written

| # | Required | Why it blocks |
| - | -------- | ------------- |
| 1 | Base URLs, sandbox and production | Nothing can be called |
| 2 | Authentication scheme (API key / HMAC / OAuth) and where credentials go in a request | Secret storage and rotation design |
| 3 | Charge initiation request and response schema; supported channels per country | The checkout data model |
| 4 | Flow type: hosted redirect, inline widget, JS SDK, or USSD push | Changes the checkout interface, not just the backend |
| 5 | Status query endpoint and the **complete** status enumeration | Reconciliation cannot be written against a partial enum |
| 6 | Webhooks: registration, payload schema, signature algorithm and header name, timestamp tolerance, retry policy | Money enters the ledger on a verified webhook; with no signature scheme there is no safe way to accept one |
| 7 | Currency handling — specifically **whether XOF amounts are sent as whole francs** | XOF has zero decimal places; a wrong assumption is a 100× error |
| 8 | Whether a payout / disbursement API exists, and its settlement timing | Decides whether payouts are automated or an operational process |
| 9 | Refund API and its constraints (partial refunds, time limits) | The refund reversal path in the ledger |
| 10 | Idempotency support on charge creation, and rate limits | Retry safety |
| 11 | Settlement schedule to the merchant account (T+N) and fee structure | Hold windows and platform margin |
| 12 | Sandbox credentials and test numbers or accounts per channel | Nothing can be tested without them |
| 13 | JavaScript and Android SDK documentation, if the SDK route is used | Changes the client integration entirely |

Items **6, 7 and 8** most often invalidate an assumed design. If only part is
available now, send 1–6 and the adapter can begin.

## How it will be implemented

The `PaymentProvider` interface in `packages/core/src/payments/provider.ts` is
provider-agnostic and does not change. `IPayMoneyProvider` gains real method
bodies; nothing else in the system is touched.

`createPayout` and `getPayout` are **deliberately absent** from the adapter
rather than declared and stubbed — declaring them would assert an answer to
item 8 that we do not have. `supportsPayouts(provider)` is how callers check.

## Integration tests

`packages/core/src/payments/ipaymoney.integration.test.ts` is the intended home
for tests against the real sandbox. They are skipped unless
`IPAYMONEY_BASE_URL` and `IPAYMONEY_API_KEY` are present in the environment, so
CI stays green without credentials and turns red the moment a sandbox run
regresses.
