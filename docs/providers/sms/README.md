# SMS provider — what must be established before one is chosen

**Nothing is selected.** No provider has been evaluated, contracted, or coded
against. `MessageSender` in `packages/core/src/auth/messaging.ts` is the whole
integration surface: two methods, no provider concepts. `ConsoleSender` is the
only implementation and refuses to run in production without an explicit opt-in.

Review decision 8 is explicit about the bar: **a provider is chosen after a real
handset delivery test in Niger, not after a web search.** This document is the
list of what has to be true and what has to be collected. It contains no claims
about any provider, because none has been verified.

## Why this is the critical path

Until a provider delivers to a real handset, nobody outside this repository can
sign in. Every other launch task is downstream of that. It is also the one item
here that engineering cannot resolve on its own — it needs a company account, a
sender registration, and money.

## The delivery test that decides it

A provider passes only if a code sent through it arrives on a real SIM in Niger,
on **each** of the three networks, within a usable time, repeatedly.

| # | Check | Passes when |
| - | ----- | ----------- |
| 1 | Airtel Niger delivery | Code arrives on an Airtel SIM in Niger |
| 2 | Orange Niger delivery | Code arrives on an Orange SIM in Niger |
| 3 | Moov Niger delivery | Code arrives on a Moov SIM in Niger |
| 4 | Latency | Arrival is fast enough that a person waiting on the sign-in screen does not give up — measure it, do not assume it |
| 5 | Repeatability | Not a single lucky send: repeated across a day, including evening peak |
| 6 | Sender identity | The sender shown on the handset is what was registered, not a rotating shortcode |

A provider that cannot demonstrate all three networks is not a candidate,
whatever its documentation says.

## What must be collected, per candidate

Nothing below is filled in. Each line is answered from the provider's own
documentation or a written answer from them — not from a search result, and not
from us.

### Coverage and routing
- Niger coverage, stated by the provider
- Airtel Niger — supported, and by which route
- Orange Niger — supported, and by which route
- Moov Niger — supported, and by which route
- Transactional / OTP routing available, separate from marketing traffic
- Whether traffic is aggregated through a third party, and which

### Sender identity
- Sender ID requirements for Niger
- Sender registration process, documents required, and lead time
- Whether alphanumeric sender IDs are permitted in Niger
- What the recipient actually sees

### Operational
- Delivery reports: available, and at what granularity
- Webhook support for delivery status, and its authentication
- Retry behaviour on failure, and whether it is configurable
- Provider-side rate limits
- Test or sandbox environment, and whether it proves real delivery

### Commercial
- Price per SMS to Niger, per network if it differs
- Minimum balance or commitment
- Account and company requirements — is an Entreprise Individuelle in Niger
  eligible, and what does onboarding need
- Billing currency and payment method
- SLA and support: hours, channels, response times

### API and security
- API authentication method
- API documentation: public, complete, and current
- Data and security terms: where message content is stored, for how long, and
  who can read it
- Data-protection terms compatible with holding subscriber phone numbers

## First procurement investigation

Evaluate these three. **None is assumed suitable, and none is preferred.**

1. **SawkiWebSMS**
2. **EasySendSMS**
3. **Twilio**

The investigation produces one filled-in table per provider using the headings
above, plus the result of the delivery test. Selection happens after that.

## What engineering has already done

- The interface is provider-agnostic: `MessageSender` has `sendSms` and
  `sendEmail`, and nothing else. A provider adapter implements those two.
- Nothing in the OTP flow knows about a provider. Issuance, rate limiting,
  hashing, attempt bounds and expiry all sit above the sender, so swapping a
  provider touches one file and no authentication or OTP business logic.
- `ConsoleSender` records what it would have sent and prints it in development,
  and refuses to start in production unless `ALLOW_CONSOLE_SENDER=yes` is set —
  so a missing provider fails loudly rather than silently dropping every code.
- Audit records which sender handled a code (`auth.otp.sent` carries
  `sender: "console"`), so a switch is visible in the record.

## What must not happen

- No provider adapter is written before that provider is selected.
- No endpoint, authentication parameter or webhook payload is invented. If the
  documentation is unavailable, the adapter throws — the same rule the
  iPayMoney adapter follows.
- No claim that delivery works until a code has arrived on a handset in Niger.
