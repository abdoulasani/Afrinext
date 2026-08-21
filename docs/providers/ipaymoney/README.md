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

## Refunds — what Phase 3 still needs, and which answers change the design

Phase 3 built refund execution against the provider interface, not against
iPayMoney. The adapter still throws. These are the facts that would let it stop
throwing, and two of them are **design-changing** rather than parametric.

| # | Required for refunds | Why it blocks | Design-changing? |
| - | -------------------- | ------------- | ---------------- |
| R1 | The refund endpoint: request schema, response schema, and the **complete** status enumeration | Nothing can be sent | No |
| R2 | Which error codes mean, in the provider's own words, **"no refund was created"** | A `failed` without that evidence is treated as `in_doubt` and never retried. With no documented list, every provider rejection becomes a manual reconciliation | No — but expensive if absent |
| R3 | **Whether a refund status query exists**, and what it can be queried by | This is the only mechanical way an unknown outcome is ever resolved. Without it, every timed-out refund waits for a person reading a statement | **YES** |
| R4 | **Whether refunds accept a caller idempotency key**, and whether a refund can be looked up by that key afterwards | After a timeout we hold no provider refund reference — our key is the only handle we have. Without lookup-by-key, R3 cannot resolve the exact case that most needs resolving | **YES** |
| R5 | Whether refund webhooks exist; payload, signature algorithm, header name | Decides whether an unknown can resolve itself without polling | No |
| R6 | Whether a refund webhook names the charge it reverses | Our webhook matcher uses the charge as the thread back when no refund reference is held | No |
| R7 | Time limits on refunding a charge, and what happens past them | Decides whether an old `refund_due` is refundable at all or is a manual credit | No |
| R8 | Whether partial refunds are supported | Phase 3 is full-amount only by decision; this decides whether that stays a decision or becomes a constraint | No |
| R9 | Whether a refund can fail *after* being accepted, and how that is signalled | Decides whether a `pending` refund needs its own resolution path | No |
| R10 | Sandbox behaviour for refunds: how to force a rejection, a timeout, and a duplicate | Nothing about refunds can be tested against the real provider without these | No |

**R3 and R4 are the ones to ask about first.** If both answers are "no", the
operational consequence is concrete and must be told to whoever staffs finance
before launch, not discovered on the first timeout: **every refund whose request
does not come back becomes a human reading an iPayMoney statement and
reconciling it under dual control.** The code already supports that path — it is
not a gap — but it is a staffing cost, and it scales with transaction volume.

### What the adapter does today

`refund()` throws, as every other method does. `getRefund()` is **declared and
throws**, unlike `createPayout`, and the difference is deliberate: omitting a
method asserts that the provider may not have the capability, and
`supportsRefundQuery(provider)` returning `false` makes callers treat every
ambiguity as manual by design. Declaring `getRefund` keeps the adapter
non-operational without deciding R3 on iPayMoney's behalf.

Nothing about the refund endpoint, its payloads, its error codes or its
signature scheme has been invented anywhere in the codebase.

## How it will be implemented

The `PaymentProvider` interface in `packages/core/src/payments/provider.ts` is
provider-agnostic and does not change. `IPayMoneyProvider` gains real method
bodies; nothing else in the system is touched.

`createPayout` and `getPayout` are **deliberately absent** from the adapter
rather than declared and stubbed — declaring them would assert an answer to
item 8 that we do not have. `supportsPayouts(provider)` is how callers check.

`getRefund` is the opposite case and is declared-and-throwing; see the refund
section above for why the two absences mean different things.

## Integration tests

`packages/core/src/payments/ipaymoney.integration.test.ts` is the intended home
for tests against the real sandbox. They are skipped unless
`IPAYMONEY_BASE_URL` and `IPAYMONEY_API_KEY` are present in the environment, so
CI stays green without credentials and turns red the moment a sandbox run
regresses.
