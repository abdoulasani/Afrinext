# The buyer profile

**Status: implemented.** A buyer supplies their name and country once, after
signing in and before paying.

## Why it exists

A payment provider asks who is paying. Phone-OTP sign-in never learned:
it proves possession of a number and nothing else.

Two columns look like they hold a name, and neither does:

| Column | What it actually holds |
|---|---|
| `users.display_name` | `22790123456@phone.afrinext.local` — the synthetic address signup mints so Better Auth's NOT NULL email is satisfied |
| `user.name` (Better Auth) | The phone string itself, written for the same reason |

Both are placeholders. Sending either to iPayMoney as `customer_name` would be
inventing a value for a provider-required field, and the second would hand a
payment provider an internal hostname. So until this existed, the iPayMoney
adapter correctly refused every charge — see the Checkout → iPayMoney Wiring
review packet.

## What is stored, and where

On the buyer's own `users` row. There is no second identity table.

| Column | Meaning |
|---|---|
| `users.full_name` | The name the buyer typed. **NULL until they do** — that is the whole point of a new column rather than reusing `display_name`, which is already populated for every account with a value that is not a name. `full_name IS NOT NULL` means a human answered. |
| `users.country_code` | The country they chose. The column has existed since `0001` with a foreign key to `countries` and never had a writer; it has one now. |

A profile is **complete** when both are present. There is no separate
`completed_at` flag: a derived fact cannot drift from the fields it derives
from, and *when* it happened is in the audit log where it belongs.

## Rules

- **The name is never derived.** Not from `display_name`, not from Better
  Auth's `name`, not assembled from a phone number.
- **The country is never inferred.** Not from the phone's calling code — a
  Niamey SIM travels, and its holder may be paying from Ouagadougou — and not
  from the store, whose country is the seller's business rather than the
  payer's.
- **Neither is ever accepted from the client at payment time.**
  `InitiatePaymentInput` carries no name, country or customer field, so there
  is nothing for a request to override. Both are read server-side from the
  buyer's own row, the same way the amount is read from the order.
- **The subject is the session.** `completeBuyerProfile` takes an `Actor` and
  **no user id**. There is no field in any request that names whose row is
  written, so the class of bug where an id in a form body is trusted cannot
  occur here.
- **The amount is unchanged.** It is still derived from the order row inside
  `initiatePayment`, and no caller can influence it.

## Validating a name without judging it

Surrounding whitespace is trimmed and internal runs collapse to a single space.
Those are typing accidents. **Nothing else is touched**: no case is forced, no
characters are rejected, no assumption is made about how many parts a name has
or which script it is written in.

A platform launching in Niger — whose buyers write in French, Hausa, Zarma and
Arabic — is the worst possible place to be confidently wrong about what a name
may contain. The only limits are length, 2 to 120 characters, which exist to
reject an empty string and a pasted document rather than to have an opinion. A
`CHECK` constraint enforces the same bounds so a future code path that writes
the column directly still cannot store junk.

The country is validated against the `countries` reference table rather than a
regex, so "is this a country Afrinext knows about" is the actual question asked.

## Where the gate is

Inside `initiatePayment`, before the payment row is written and therefore
before any provider request could be built.

That position matters. An incomplete profile costs nothing: no row to clean up,
no charge that might exist, and nothing for `payments_one_live_per_order` to
wedge — the buyer completes their profile and pays the same order. It runs
*after* the order checks so the more specific truth wins: an order that is
already paid or expired says so, rather than sending someone to fill in a form
that would not have helped.

The screen is presentation only. Someone who deletes the form from the DOM and
posts the pay action directly is refused identically.

## Privacy

The audit log records that a profile was completed and which country was
chosen. **It does not record the name.** The current value is one column away,
and repeating personal data into an append-only table buys nothing. No OTP,
code or credential is logged anywhere in this path.

The buyer is told, on the form and before they type, that the information is
sent to the payment provider for the transaction.

## What this deliberately does not do

- **No general profile-editing screen.** The form appears where it is needed —
  at the point of payment — and a buyer can correct what they typed by
  submitting it again. A full account-settings surface is separate work.
- **No KYC.** The name is self-declared. Nothing verifies it against a
  document, and nothing here should be read as implying otherwise
  (assumption A12).
- **No signup change.** The OTP flow, its rate limits, its hashing and Better
  Auth's verification are untouched. These fields are not part of the OTP
  request and never travel with it.
- **No payment channel.** Whether Afrinext offers mobile money, cards or both
  is an open product decision, and nothing defaults it.
