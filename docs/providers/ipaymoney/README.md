# iPayMoney — what the documentation says, and what it does not

**Status: the official documentation is now IN this repository.**
`Documentation-de-iPayMoney.docx` is authoritative;
`documentation-extract.md` is a verbatim text extract of it so claims can be
checked against a line number. Every line reference below (`L161`) points into
that extract.

**The payment endpoints are implemented; refunds are not, because there are
none.** See *What the adapter does today* below for exactly what each method
does. Several questions must still be answered by iPayMoney before real money
moves — they are tracked in `support-questions.md`.

Supplied by the operator of AFRI NEXT TECHNOLOGIE on 2026-08-21.

---

## The distinction this document exists to protect

The documentation uses **"remboursement"** for something that is **not a
customer refund**, and getting that wrong would build the wrong thing:

> « Vous pouvez à tout moment demander depuis votre tableau de bord le
> **remboursement de vos avoirs**. Cela s'appelle un **reversement**. » — L97

*Your* holdings, to *your* account. That is a **merchant withdrawal**. It is
configured from the dashboard, it pays out to the merchant's own mobile money
or bank account, it has a 50 000 FCFA floor and a three-day holding rule
(L297), and it has nothing to do with returning money to a buyer.

Every one of the 30 occurrences of *remboursement* / *reversement* in the
document is in that sense. There is no other.

Three things that must never be conflated:

| | What it is | In the documentation |
|---|---|---|
| **Payment status** | Did the buyer's charge succeed? | `GET /api/v1/payments/{reference}` (L228) |
| **Reversement** | The merchant withdrawing their own balance | Dashboard only, no API (L96–L119, L281–L301) |
| **Customer refund** | Returning a buyer's money | **Absent** |

---

## Payment API — DOCUMENTED

### Create a payment

`POST https://i-pay.money/api/v1/payments` (L161)

Headers (L162–L168):

| Header | Value |
|---|---|
| `Ipay-Payment-Type` | `mobile` or `card` |
| `Ipay-Target-Environment` | `sandbox` or `live` |
| `Authorization` | `Bearer <secret key>` |
| `Content-Type` | `application/json` |

Body (L169–L177):

| Field | Type | Notes |
|---|---|---|
| `customer_name` | string | |
| `currency` | string | **XOF** |
| `country` | string | country code — **NE** for Niger, BJ for Benin |
| `amount` | **string** | "must be greater than 100" |
| `transaction_id` | string | our reference for the transaction |
| `msisdn` | string | the payer's number |

Success `200` (L179–L185):

```json
{ "status": "succeeded", "reference": "vslfxgawkpkm" }
```

Documented errors: `400` malformed / bad MSISDN / missing key, `401`
`Unauthorized: No Valid Key`, `403` `Forbidden: Environment Not Available`,
`406` `Not Acceptable: Invalid Content Type`, `422`
`External Reference Not Valid` — **reference invalid or already exists**
(L187–L226).

### Query a payment

`GET https://i-pay.money/api/v1/payments/{reference}` (L228)

The path parameter is *"la référence que vous avez reçu en réponse lors du
Post"* (L232) — **iPayMoney's reference, not ours.**

Response `200` (L241–L249):

```json
{
  "external_reference": "Reference-13409",
  "reference": "vslfxgawkpkm",
  "status": "failed",
  "msisdn": "22787505050"
}
```

### Webhooks — DOCUMENTED

- Configured in the dashboard under Développeurs → Webhooks (L308–L320).
- **Exactly two event types: success and failure** (L321). There are no others.
- Must answer `2xx`; anything else, 3xx included, counts as not received (L327).
- On non-receipt iPayMoney **retries 5 times**, 500 ms apart and increasing
  (L329).
- Payload (L359–L368):

```json
{ "data": { "external_reference": "random-38",
            "reference": "yeweyk6rd7cm",
            "status": "succeeded",
            "msisdn": "40410000001" } }
```

### Sandbox — DOCUMENTED

Test MSISDNs and their scenarios (L148–L159):

| MSISDN | Scenario |
|---|---|
| 40410000000, 40410000001 | success |
| 40410000002, 40410000003 | error |
| 40410000004, 40410000005 | insufficient_fund |
| 40410000006, 40410000007 | declined |
| 40410000008, 40410000009 | pending (180 seconds) |

### Fees — DOCUMENTED

- **3 %** of the amount on every mobile-money collection (L271).
- **3 %** on Visa / Mastercard (L272).
- Reversement to mobile money inside Niger: **no fee** (L276).
- Reversement to a bank account: **7 000 FCFA flat**, whatever the amount
  (L119).

---

## Refunds — the investigation, and its result

Every question below was answered by reading the document, not by inference.
**Nothing here may be filled in from another provider's conventions.**

| # | Question | Answer |
|---|---|---|
| R1 | Endpoint to refund a customer payment | **NOT DOCUMENTED** |
| R2 | HTTP method for creating a refund | **NOT DOCUMENTED** |
| R3 | Required refund request body | **NOT DOCUMENTED** |
| R4 | Which identifier a refund uses | **NOT DOCUMENTED** |
| R5 | Refund response and refund reference | **NOT DOCUMENTED** |
| R6 | Refund status endpoint | **NOT DOCUMENTED** |
| R7 | Refund webhook | **NOT DOCUMENTED** — and the document states positively that only two event types exist, success and failure on a transaction (L321) |
| R8 | Refund idempotency mechanism | **NOT DOCUMENTED** |
| R9 | Querying a refund by any identifier | **NOT DOCUMENTED** |
| R10 | Behaviour on refund success / rejection / timeout / network failure / 5xx / duplicate | **NOT DOCUMENTED**. For *payments* only 400, 401, 403, 406 and 422 are documented; no timeout, connection-failure, 5xx or duplicate-delivery semantics are documented anywhere |
| R11 | Sandbox refund support | **NOT DOCUMENTED** — the sandbox table is payment scenarios only |
| R12 | Mobile Money refund support | **NOT DOCUMENTED** |
| R13 | Visa / Mastercard refund support | **NOT DOCUMENTED** |
| R14 | Refund processing time | **NOT DOCUMENTED** |
| R15 | Refund fees | **NOT DOCUMENTED** — the fees section covers purchase fees and reversement fees only |

### The one adjacent thing, which is not a refund

> « le marchand peut être amené à mettre fin à **une opération en cours**. Cela
> peut se faire à travers le menu Paiements. » — L304

A merchant may end an operation **in progress**, from the **dashboard menu**.
That is a cancellation of something not yet complete, it has no API, no request
or response schema, no identifier and no stated financial effect. It is
**UNCLEAR** what it does and it is **not** a refund of a completed payment.

### Conclusion

**The supplied documentation contains no customer-refund operation of any kind.**

---

## Unknowns that are not about refunds

These are gaps in the *payment* documentation, found while checking it against
our provider contract. Each one has a consequence for the integration.

| # | Unknown | Consequence |
|---|---|---|
| P1 | **No amount in the webhook payload, and none in the payment-status response** | Our webhook boundary cross-checks the amount exactly when the event carries one. iPayMoney carries none in *either* channel, so that check can never run and the charged amount is not independently verifiable from the provider at all |
| P2 | **No event id in the webhook payload** | Our replay defence is `UNIQUE (provider, provider_event_id)`. iPayMoney sends no id and retries five times, so duplicates are certain and the adapter must derive an id from what the event does carry |
| P3 | **No lookup by our own identifier** | `GET` takes iPayMoney's `reference`. If a response is lost we hold no reference, and there is no documented way to ask "what happened to my `transaction_id`?" |
| P4 | **`transaction_id` vs `external_reference`** | We send `transaction_id`; responses return `external_reference`. The dashboard section says the external reference is "générée de façon automatique" (L126), which contradicts us supplying it |
| P5 | **The complete status enumeration** | Only `succeeded` and `failed` appear in examples. The sandbox names five *scenarios*, which are not the same thing as status values |
| P6 | **Webhook header name contradicts the example** | The prose names `x-iPayMoney-secret` (L332); the example shows `secret-hash` (L338) whose value is the secret key itself, `sk_...` — a shared secret echoed in a header, not a signature over the body |
| P7 | **Amount units** | `amount` is a string and must exceed 100. XOF has zero decimals, so whole francs is the only sensible reading, but the document does not say so |
| P8 | **No 5xx semantics** | Nothing documents what a 5xx from iPayMoney means for the transaction, which is precisely the case our classifier must treat as unknown |

**P6 is a security finding, not a detail.** If the header carries the static
secret rather than an HMAC over the request body, then the "signature" does not
cover the payload: anyone who obtains the secret — from a log, a proxy, a
mis-scoped error report — can forge any event, and the secret is transmitted on
every single webhook. Our boundary is built to verify a signature over the raw
bytes. Whether iPayMoney can provide one must be asked before a webhook is
trusted with money.

---

## Assumptions register

Every place the adapter had to decide something the documentation does not
state. Each one is a hypothesis until iPayMoney answers the question beside it,
and each is cited from the code that relies on it.

| # | Assumption | Why it was made | Confirmed by |
|---|---|---|---|
| A1 | Base URL is `https://i-pay.money` and both operations live under `/api/v1/payments` | The only host and paths the documentation shows (L161, L228) | A sandbox run |
| A2 | `transaction_id` is **ours** to supply, and the derived idempotency key goes in it | The request body table lists it as a field we send (L170–L177); the dashboard section's "générée de façon automatique" (L126) describes the *external reference*, which is P4 | K10 |
| A3 | `amount` is **whole francs** for XOF | XOF has zero decimal places, so a minor unit *is* a franc. The field is a string with a floor of 100 and no unit stated | **K13** |
| A4 | `country` is a two-letter code, and **the caller decides whose** country it is | Documented only as "le code du pays de la transaction" (L174). The adapter refuses rather than choosing | **K17** |
| A5 | `customer_name` is required | Listed in the body table with no optionality marked, and the documented 400 says "Missing params" | A sandbox run |
| A6 | A **4xx** from `POST` means no payment was created; a **5xx** means the outcome is unknown | 4xx cases are documented refusals with named causes (L206–L226). Nothing documents 5xx at all | **K14** |
| A7 | The webhook header carries the **shared secret itself**, under either `secret-hash` or `x-iPayMoney-secret` | The prose and the example disagree (L332 vs L338), and the setup instructions say to paste the API secret into "Secret Hash" | **K7** |
| A8 | A `status` outside `succeeded` / `failed` is **refused**, never mapped | Those two are the only values shown anywhere. The five sandbox *scenarios* are not status values | **K12** |
| A9 | Headers are `Ipay-Payment-Type`, `Ipay-Target-Environment`, `Authorization: Bearer <secret key>` | Exactly as listed at L162–L168 | A sandbox run |
| A10 | Only **XOF** is supported | The only currency the documentation uses, and no minor-unit convention is documented for any other | iPayMoney's currency list |

Assumptions in bold-question rows are the ones that would cost money if wrong.
A3 is a factor of 100; A7 is whether a forged notification can move an order;
A6 is whether an ambiguous charge becomes a definite failure.

---

## What the adapter does today

| Method | State |
|---|---|
| `createCharge()` | **Implemented** against `POST /api/v1/payments` |
| `getCharge()` | **Implemented** against `GET /api/v1/payments/{reference}` |
| `verifyWebhook()` | **Implemented as a notification**, see below |
| `refund()` · `getRefund()` | **Throw.** There is no customer-refund operation to implement |
| `createPayout()` · `getPayout()` | **Absent.** The reversement is a dashboard withdrawal, not a payout API |

**No request has ever been made to iPayMoney from this repository.** The adapter
is written against the documentation and is a hypothesis until a real sandbox
run confirms it.

### The webhook is a notification, not evidence

Because iPayMoney's documented authentication is the API secret echoed in a
header (P6), it does not cover the request body — so the adapter does not
believe what a notification says. It checks the header in constant time, reads
only the payment reference out of the body, and then **re-reads the status from
`GET /api/v1/payments/{reference}`** over our own authenticated connection. The
returned event carries the confirmed status, never the claimed one.

Forging a notification therefore buys nothing: it can make Afrinext ask a
question, not answer one. This holds even if the secret leaks, which the
documented scheme does not.

It costs one thing, stated plainly: verification now depends on iPayMoney's API
being reachable. When the lookup fails, nothing is confirmed, the route answers
non-2xx and iPayMoney retries — the event is not lost, and an unconfirmable
notification is never treated as a confirmation.

It does **not** fix the amount (K8): the status endpoint states no amount
either, so the boundary's amount cross-check still cannot run for this provider.

### The event id is derived

iPayMoney sends no event id (P2) and retries five times, so duplicates are the
documented behaviour. The adapter derives `{reference}:{confirmedStatus}`:

- **reference** so two payments cannot collide;
- **status** so a success and a failure for the same payment do not collapse
  into one another;
- **the confirmed status, never the claimed one**, so nobody reaching the
  endpoint can mint fresh ids at will;
- **no hash of the body**, because a retry that re-serialises the payload is the
  same fact and must deduplicate.

Proved against a real database in `ipaymoney-replay.test.ts`: five deliveries of
one event grant one entitlement.

### Refunds

`refund()` throws. `getRefund()` is **declared and throws**, unlike
`createPayout`, and the difference is deliberate: omitting a method asserts the
provider may lack the capability, and `supportsRefundQuery(provider)` returning
`false` makes callers treat every ambiguity as manual *by design*. Declaring it
keeps the adapter non-operational without deciding on iPayMoney's behalf.

Nothing about a refund endpoint, payload, error code or signature scheme has
been invented anywhere in the codebase.

---

## Live activation — DOCUMENTED

Switch to Live in the dashboard, then submit under Paramètres → Information
Légale (L48–L61). Required:

- Nom de l'entreprise
- Numéro de téléphone
- Adresse du siège social
- Secteur d'activité
- Site web / Application
- Numéro : ID card / passeport
- N° du registre de commerce
- Numéro IFU/NIF (numéro fiscal)

Documents to upload:

- RCCM
- IFU/NIF
- Pièce d'identité

Save, then submit. The answer arrives by email after examination. Until then the
account is **sandbox only** (L45).

---

## Integration tests

`packages/core/src/payments/ipaymoney.integration.test.ts` is the intended home
for tests against the real sandbox. They are skipped unless `IPAYMONEY_BASE_URL`
and `IPAYMONEY_API_KEY` are present, so CI stays green without credentials and
turns red the moment a sandbox run regresses.

**No sandbox call has ever been made from this repository.**
