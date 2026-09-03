# The payment channel

**Status: decided and implemented.** Afrinext launches with **one** channel:
mobile money.

## The provider value, quoted rather than chosen

`Ipay-Payment-Type` is a required HTTP **header**, on both documented endpoints,
and its permitted values are stated verbatim and identically in each:

> « Ipay-Payment-Type | string | Doit comporter **mobile** ou **card** »
> — extract **L165** (`POST /api/v1/payments`)
> — extract **L238** (`GET /api/v1/payments/{reference}`)

So the launch value is `mobile`. Nothing about it is inferred.

### Is it right for Niger and XOF?

| Question | Documented | Where |
|---|---|---|
| Which operators is "mobile money"? | Airtel Money, Zamani Cash, Moov Money — the three Niger operators | L254, L256–257 |
| Which currency? | `currency` \| string \| **XOF** | L172 |
| Which country code? | « **NE** pour le Niger » | L173 |
| Are the sandbox numbers for this channel? | « les numeros de test à utiliser pour les paiements **mobile** » | L147 |
| Fee | 3 % on each mobile-money collection | L271 |

The documentation does not print a per-country channel matrix, so "mobile money
works for Niger/XOF" is recorded as **assumption A13** and is one of the first
things a real sandbox call confirms.

## Two vocabularies, on purpose

| Layer | Word |
|---|---|
| Afrinext domain, and anything a browser posts | `mobile_money` |
| iPayMoney header | `mobile` |

They are different, and that difference is the security property.

```
browser ──"mobile_money"──▶ parsePaymentChannel()
                                 refuses everything not in the allowlist,
                                 INCLUDING "mobile" and "card"
                                          │
                                          ▼
                            IPAYMONEY_PAYMENT_TYPE[channel] ──▶ "mobile"
                                 the only place this literal exists
```

A browser cannot hand iPayMoney a header value of its choosing — not because
the value is filtered, but because **the domain does not speak that vocabulary
at all**. Someone who reads `mobile` out of this repository and posts it is
refused exactly as firmly as someone posting nonsense.

`card` is a documented iPayMoney value and is **deliberately absent from the
mapping**. Afrinext does not offer card payments, and a mapping entry for a
channel the business has not adopted is a route to sending one.

## Rules

- **No default, anywhere.** `InitiatePaymentInput.channel` is **required**, so a
  caller that omits it fails to compile; `parsePaymentChannel` refuses a missing
  value at runtime for callers that were not compiled against that shape. The
  documentation states no default for `Ipay-Payment-Type`, and choosing one on a
  buyer's behalf is a decision about their money.
- **Validated before anything happens.** The check runs before the payment row
  is written and therefore before any provider request could be built. An
  invalid channel leaves no row and sends nothing.
- **The allowlist is the single source.** The checkout screen is built from
  `PAYMENT_CHANNELS`, so it can only offer what the server accepts. Adding a
  channel is one line in the allowlist plus a provider mapping plus a label —
  and the label record is exhaustive, so forgetting it fails the build.
- **The choice is visible.** One option is still rendered as a checked radio
  with its operators named, not as a hidden input. A payment method the buyer
  never saw is not a method they chose.
- **Nothing else changed.** The amount is still server-derived from the order,
  the phone still comes from the verified sign-in number, and the name and
  country still come from the buyer's profile.

## What this deliberately does not do

- **No card payments.** Not offered, not mapped, not rendered.
- **No operator selection.** iPayMoney routes by MSISDN; the documentation gives
  no field for naming Airtel versus Moov, and inventing one is not available.
- **No change to settlement, the ledger, payouts, refunds, the late-payment
  state machine, webhook verification, OTP or signup.**
