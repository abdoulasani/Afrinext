# Email + password authentication, and the programme choice

**Status: VALIDATED AND IMPLEMENTED.** Sections 1–16 are the proposal as it was
approved and are left as written, so a reviewer can compare what was proposed
against what was built. **Section 17, at the end, records what was actually
built and the two places the proposal was wrong about Better Auth.**

This document audits what authentication is today, states what breaks if we
change it naively, and proposes a migration. It is written to be argued with:
every claim about the current system was checked against the code, and the file
and line are named so a reviewer can disagree with the source rather than with
me.

---

## 1. Current architecture

### What Better Auth is already configured to do

`packages/core/src/auth/better-auth.ts` is more capable than the UI suggests.

| Capability | State today |
|---|---|
| `emailAndPassword` | **already enabled**, `minPasswordLength: 10`, `autoSignIn: false` |
| Password hashing | Afrinext's own **scrypt** (`auth/password.ts`), not Better Auth's default, with parameters encoded in the hash and a `needsRehash()` ready for a later Argon2id move |
| `emailOTP` plugin | **already mounted**, 6 digits, `storeOTP: "hashed"`, TTL from `OTP_POLICY` |
| `phoneOtp` plugin | Afrinext's own, because Better Auth's `phoneNumber` plugin writes codes in cleartext and offers no hook |
| Sessions | Better Auth's `session` table is the only session store; `expiresIn` / `updateAge` configured; extra field `elevatedAt` for step-up |
| Endpoints | `apps/web/src/app/api/auth/[...all]/route.ts` mounts everything, **including sign-out** |

**So email+password is not a new capability. It is an enabled capability with
no user interface.** That is the single most important finding in this audit:
the work ahead is mostly product surface, migration and email delivery — not
authentication primitives.

### Identity model

Two tables, deliberately separated:

- **`user`** (Better Auth) — credentials. `email TEXT NOT NULL UNIQUE`,
  `emailVerified BOOLEAN NOT NULL`, `phoneNumber TEXT UNIQUE`,
  `phoneNumberVerified BOOLEAN`.
- **`users`** (Afrinext) — the domain identity that `role_assignments`,
  `consent_records`, `audit_logs`, `ledger accounts`, orders and entitlements
  all reference. Linked by `users.auth_user_id`.

`resolveActor()` (`auth/session-bridge.ts`) turns a session into an actor and
**returns `undefined` unless `users.status = 'active'`**. Status is one of
`pending_consent | active | suspended | closed`.

### One-time codes

`otp_challenges` holds every Afrinext-issued code, hashed with HMAC-SHA256 under
a key derived from the application secret. The database — not the application —
enforces one live challenge per identifier and purpose, the attempt ceiling, and
single use. Columns constrain:

- `kind IN ('phone','email')`
- `purpose IN ('sign_in','verify_identity','step_up')`

Rate limiting counts in PostgreSQL (`packages/core/src/ratelimit`), reads its
policy from `platform_settings`, and answers a refusal as **429 with
`Retry-After`**, never a 500.

### Roles

`member`, `seller`, `store_owner`, `finance`, `support`. Granted through
`role_assignments`; every decision goes through `authorize()`.

### What does NOT exist

Checked and absent:

- **No sign-up page.** `/[locale]/sign-in` is the only auth screen, and it both
  creates and signs in, because phone OTP does not distinguish the two.
- **No sign-out in the UI.** The endpoint exists; nothing links to it.
- **No password field anywhere in the UI.**
- **No subscription, plan, programme or membership table.**
- **No referral table.** `referralRateBps` exists in the commission engine and
  `referral_terms` exists as a legal document kind, but there is no data model
  that says who referred whom.
- **No email provider.** `MessageSender` (`auth/messaging.ts`) already declares
  `sendSms` AND `sendEmail`; the only implementation is `ConsoleSender`, which
  writes to the log and refuses to start under `NODE_ENV=production` unless
  `ALLOW_CONSOLE_SENDER=yes`.

---

## 2. Problems and limitations

**P1 — `user.email` is `NOT NULL UNIQUE`, and phone signup fabricates one.**
The phone plugin mints `<digits>@phone.afrinext.local`. Every existing
phone account therefore already occupies an email address that looks real to
the schema and is not. This is the crux of the migration: a naive "sign in with
email" would let somebody type that synthetic address, and a naive password
reset would try to send mail to a domain that does not exist.

**P2 — `otp_challenges.purpose` has no `password_reset`.** A CHECK constraint
refuses it. Password reset needs a migration; there is no way around it.

**P3 — "don't block the dashboard on unverified email" collides with
`pending_consent`.** These are different gates and must not be conflated.
Consent is a legal requirement already reviewed and enforced by
`resolveActor()`; email verification is a trust signal. The proposal keeps
consent blocking and makes verification non-blocking.

**P4 — The Entrepreneur programme is a paid subscription, and Afrinext cannot
charge anybody.** `PAYMENT_PROVIDER=mock` is the only implemented provider;
iPayMoney throws by design. A 2 000 FCFA/month subscription has no rail. See
§11 — this is a decision, not a detail.

**P5 — The referral programme "rules already defined" are not defined in data.**
The commission engine can apportion a referral share; nothing records a
referral relationship. Entrepreneur access to it cannot be built without that
model.

**P6 — Enumeration.** The current OTP endpoint answers identically for every
failure, on purpose. Email+password introduces three new places to leak whether
an address exists: signup, sign-in and password reset.

---

## 3. Proposed architecture

**Both credentials remain valid. Nothing is retired in this milestone.**

```
                    ┌───────────────────────┐
  email + password  │                       │
  ───────────────►  │   Better Auth         │   session
                    │   (credentials only)  ├──────────►  resolveActor()
  phone + OTP       │                       │            ├─ users.status = active?
  ───────────────►  │   user / session /    │            └─ → Actor
                    │   account / verification            authorize() decides
                    └───────────┬───────────┘             the rest
                                │ auth_user_id
                                ▼
                          users (domain)
                  roles · consent · ledger · orders
```

Better Auth continues to own **authentication only**. `authorize()` keeps every
authorization decision. Nothing in the domain learns that email exists.

Codes for email verification and password reset go into **`otp_challenges`**,
the table that already hashes, expires, bounds attempts and enforces single use
in PostgreSQL — not into Better Auth's `verification` table, so there is one
authoritative store and one audited refusal shape.

---

## 4. Migration strategy for existing accounts

Four populations, four answers. **Nothing is deleted.**

| Population | Today | After |
|---|---|---|
| **A** — phone only, synthetic email | `phoneNumber` set, `email = <digits>@phone.afrinext.local`, `emailVerified = false` | Signs in by phone exactly as now. Offered "add an email" in settings. Cannot receive mail until they do. |
| **B** — phone + real email later | — | Adding a real email replaces the synthetic address, sends a verification code, sets `emailVerified` on success. Phone sign-in keeps working. |
| **C** — new email+password accounts | — | `phoneNumber` NULL. Cannot use phone sign-in until they add one. |
| **D** — existing sessions | valid | **Remain valid.** No forced sign-out: the session table is untouched and nothing about the session's meaning changes. |

**The synthetic address is quarantined rather than migrated.** A single helper
answers "is this a real address" by domain suffix, and three paths consult it:

1. Sign-in by email **refuses** a synthetic address — with the same generic
   answer as a wrong password, so it leaks nothing.
2. Password reset **never sends** to one, and answers exactly as it does for an
   address that does not exist.
3. The unverified-email banner says "add an email" rather than "verify your
   email" when the address is synthetic, because there is nothing to verify.

No backfill script runs against existing rows. Migration is per-account and
user-initiated, which means it cannot go wrong in bulk at 3am.

---

## 5. Data model changes

Every change is additive. No column is dropped, no CHECK is loosened.

**M1 — `otp_challenges.purpose` gains two values.**
`sign_in | verify_identity | step_up | email_verification | password_reset`.
A CHECK replacement, forward-only.

**M2 — `users.programme`** — `TEXT NOT NULL DEFAULT 'vendeur'`, CHECK
`IN ('vendeur','entrepreneur')`. **This is a declared intent, not an
entitlement.** It grants nothing. It exists so the signup choice is remembered
and so the Entrepreneur upsell can be addressed to the right people.

**M3 — `programme_subscriptions`** — the paid lifecycle, kept apart from the
choice above precisely because choosing is not paying.

| column | meaning |
|---|---|
| `id`, `user_id` | — |
| `programme` | `entrepreneur` |
| `status` | `pending_payment \| active \| past_due \| cancelled \| expired` |
| `price_minor`, `currency` | frozen at subscription time, like a fee snapshot |
| `current_period_start/end` | — |
| `order_id` | the order that paid for the current period, when one exists |

**Nothing reads this table for permissions in this milestone.** It records
state; `authorize()` is not taught about it until the rules are agreed.

**M4 — nothing for referral.** Deliberately out of scope. See §11.

---

## 6. Signup flow

```
/[locale]/sign-up
  ├─ 1. Programme          Vendeur (0 FCFA) · Entrepreneur (2 000 FCFA/month)
  ├─ 2. Email
  ├─ 3. Password           ≥10 chars (the existing minimum), show/hide
  ├─ 4. Confirm password
  └─ 5. Accept terms_of_use + privacy_policy   ← the SAME consent gate as today
```

Server, in order:

1. Rate-limit the address and the IP (`auth.signup`, new rule).
2. Create the Better Auth user. **A duplicate email answers exactly as a
   success would**, and no account is created — the address that already exists
   is not disclosed.
3. `databaseHooks.user.create.after` already creates the `users` row with
   `status = 'pending_consent'`. Unchanged.
4. Record consent for both documents at their exact versions →
   `status = 'active'`.
5. Store the programme choice on `users.programme`.
6. Issue an `email_verification` code, send it, audit the send.
7. Sign in and land on the dashboard.

Choosing Entrepreneur creates **no** subscription row and **no** payment. It
sets `programme` and shows the activation call to action. §11.

---

## 7. Email verification flow

- Code: 6 digits, in `otp_challenges` (`kind='email'`,
  `purpose='email_verification'`), HMAC-hashed, TTL from the stored policy.
- The database enforces single use, one live challenge per address+purpose, and
  the attempt ceiling — the same three properties the phone path already relies
  on.
- On success: `user.emailVerified = true`, the challenge is consumed, the
  banner disappears, and it is audited.
- **Every failure answers identically** (`auth.otp_invalid`), matching the
  existing endpoint. The real reason goes to the audit log.
- Resend is rate-limited **on issuance, not only on attempts** — the rule the
  OTP work established, because bounding attempts alone protects nothing if
  codes can be requested without limit.

**Access is not blocked.** An unverified account reaches the dashboard and sees
a banner offering: *Vérifier mon e-mail* · *Renvoyer le code* · *Modifier
l'adresse*. Changing the address re-issues a code and leaves `emailVerified`
false.

What verification is NOT allowed to unlock in this milestone: nothing changes
about roles, permissions, payouts or step-up. It is a trust signal we record.

---

## 8. Sign-in flow

Email + password, submitted to Better Auth's existing credential path.

- Wrong password, unknown address, and synthetic address all return **one
  generic refusal**.
- Rate-limited per address and per IP (`auth.signin`, new rule) in PostgreSQL,
  answering 429 with `Retry-After`.
- Every attempt audited: outcome, never the password, never whether the address
  existed.
- Phone OTP sign-in stays exactly where it is, on the same screen, as a second
  tab or a secondary link — the launch market is phone-first and removing it
  would strand population A.

---

## 9. Forgot password flow

```
email → code → new password → confirm → sign in
```

- Always answers "if that address exists, a code has been sent". Always. This
  is the enumeration defence and it must not be weakened for a nicer error.
- Code in `otp_challenges` (`purpose='password_reset'`), hashed, short TTL,
  single use, attempt-bounded, issuance rate-limited.
- Never sent to a synthetic address.
- On success: password rehashed with scrypt, **all other sessions for that
  account revoked**, the current one re-established, and the event audited.
  Session revocation on password change is the point of the flow — a reset that
  leaves an attacker's session alive has achieved nothing.

---

## 10. Logout

The endpoint already exists. The work is the UI: *Se déconnecter* in the Menu
drawer's account section, a POST (never a GET link — a prefetch would sign
people out), which calls Better Auth's sign-out, deletes the session row
server-side, clears the cookie, and audits it.

---

## 11. Programmes — and two things I cannot build honestly

**Vendeur (0 FCFA)** is the default. It needs no subscription and no payment.
It maps to what `seller` already means, and the existing store-creation
permission is unchanged.

**Entrepreneur (2 000 FCFA/month)** is where two problems sit, and I would
rather name them now than discover them in implementation.

> **DECISION NEEDED 1 — there is no way to charge anybody.**
> `PAYMENT_PROVIDER=mock` is the only implemented provider and iPayMoney throws
> by design. A monthly subscription has no rail, no recurring mechanism, and no
> way to observe a renewal. I can build the *state machine* and the *choice*,
> and leave activation as an explicit, unimplemented step — or we wait for
> iPayMoney. What I will not do is show a subscription as active when nothing
> was charged.

> **DECISION NEEDED 2 — the referral programme has no data model.**
> "Access to the recommendation programme according to the rules already
> defined" — those rules exist as a commission *capability* and a legal
> *document kind*, not as tables. Nobody can be recorded as having referred
> anybody. This is its own milestone, and Entrepreneur cannot grant access to
> something that does not exist yet.

My recommendation: ship signup, verification, sign-in, reset and logout with the
programme **choice** recorded and Entrepreneur activation deferred, clearly
labelled as such in the UI. That is honest, it is testable, and it does not
block the auth migration on the payment provider.

---

## 12. Security

| Concern | Answer |
|---|---|
| Password storage | Existing scrypt with encoded parameters; `needsRehash()` drives a later Argon2id move without invalidating a single hash |
| Minimum length | 10, already configured. No composition rules — length beats symbol classes, and rules push people to `Password1!` |
| Enumeration | Signup, sign-in and reset answer identically whether or not the address exists |
| Codes | Hashed under a key derived from the app secret. A stolen table does not contain the key |
| Single use, expiry, attempts | Enforced by PostgreSQL, not by application code, exactly as the phone path is |
| Issuance limits | Rate-limited on sending, not only on verifying |
| Reset | Revokes other sessions |
| Step-up | Untouched. Payout-sensitive actions still require fresh re-verification |
| Audit | Every auth event logged; the code is never logged, never audited, never returned |
| Timing | Password verification runs even for an unknown address, so a missing account is not faster than a wrong password |

---

## 13. Email infrastructure

**No provider is configured, and this proposal does not pretend one is.**

What exists: `MessageSender` already declares `sendEmail`. `ConsoleSender`
implements it by writing to the log and refuses `NODE_ENV=production` without
`ALLOW_CONSOLE_SENDER=yes`.

What is needed:

1. **`EmailSender` stays the whole surface.** No provider SDK reaches the
   domain, exactly as `PaymentProvider` and `ContentStorage` are handled.
2. **A development adapter** — the existing `ConsoleSender`, unchanged.
3. **A preview adapter** that writes messages to a table or a file so a code can
   be read without a provider account.
4. **A real provider, chosen by you.** Candidates worth comparing on
   deliverability to African inboxes and on price: Resend, Postmark, Brevo,
   Amazon SES. I will not write an adapter against an API I have not read.

> **DECISION NEEDED 3 — which email provider.** Until one exists, verification
> and reset codes can be exercised end to end in development and CI, and **not
> against a real inbox**. The preview will need `ALLOW_CONSOLE_SENDER=yes` and
> codes read from the log, which is acceptable for a preview and never for
> production.

Environment variables, once chosen: `EMAIL_PROVIDER`, `EMAIL_API_KEY` (secret),
`EMAIL_FROM`, `EMAIL_REPLY_TO`. Same posture as `CONTENT_S3_*` — declared in
`render.yaml` as `sync: false`, never valued in Git.

---

## 14. Test plan

Unit and DB integration (`packages/core`):

- signup creates user + domain row + consent, status becomes active
- signup with Vendeur and with Entrepreneur records the programme and **grants
  nothing extra** in either case
- duplicate email: no second account, and the response is indistinguishable
- password below the minimum refused; confirmation mismatch refused
- verification code: valid · expired · wrong · **reused** · after attempt
  ceiling — all answering identically
- resend issues a new code and invalidates the previous one
- resend is rate-limited on issuance
- reset: valid · expired · reused · wrong code
- reset revokes other sessions and leaves the current one usable
- reset never sends to a synthetic address, and says so to nobody
- sign-in: correct · wrong password · unknown address · synthetic address
- existing phone account still signs in, keeps its roles, keeps its consent
- a phone account adding a real email replaces the synthetic one
- `resolveActor` still refuses non-active users
- unverified email does NOT reduce any permission

Browser (`apps/web/e2e`):

- signup → dashboard with the banner → verify → banner gone
- signup → dashboard reachable while unverified (the explicit product rule)
- sign-in, wrong password, forgot password, reset, sign in with the new password
- logout, then a protected route refuses
- a seller's permissions survive the whole journey

Adversarial, in the spirit of the existing suite:

- verification code from account A cannot verify account B
- reset code cannot be replayed
- removing the banner from the DOM changes nothing server-side
- programme chosen in a request body cannot grant a role

---

## 15. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Synthetic addresses treated as real | **High** | Quarantined by one helper, consulted by sign-in, reset and the banner; tested from all three directions |
| Enumeration through the new surfaces | High | Identical answers; tested |
| Existing accounts locked out | High | Phone path untouched, sessions untouched, no bulk backfill |
| Entrepreneur shown as active without payment | High | Subscription state separated from programme choice; nothing reads it for permissions |
| Codes undeliverable in production | High | `ConsoleSender` already refuses production; a provider must exist before launch |
| `purpose` CHECK migration | Medium | Forward-only, additive |
| Consent and verification confused | Medium | Consent keeps blocking; verification never does |
| Rate limits too tight for carrier NAT | Medium | Reuse the per-IP lesson already learned: limits come from `platform_settings`, not literals |

---

## 16. Implementation order

Each step ends green — lint, typecheck, tests, browser tests — before the next
begins.

1. **Migration** — `otp_challenges.purpose` gains the two values;
   `users.programme`; `programme_subscriptions`. Schema only.
2. **`EmailSender` boundary** — the interface, the console adapter, the preview
   outbox. No provider.
3. **Domain: verification** — issue, verify, resend, rate limits, audit. Tests
   before UI.
4. **Domain: password reset** — issue, verify, set, session revocation. Tests.
5. **Synthetic-address quarantine** — the helper and its three call sites.
6. **Signup screen** — programme, email, password, consent. Sahel, mobile-first.
7. **Sign-in screen** — email+password, phone OTP retained.
8. **Unverified banner** — verify, resend, change address.
9. **Forgot-password screens.**
10. **Logout** in the Menu drawer.
11. **Programme choice recorded**, Entrepreneur activation explicitly deferred.
12. **Full verification** — the whole suite, mutation matrix extended to the new
    refusals, FR/EN parity, a11y, overflow at the six widths.

Steps 1–5 are domain and touch no screen. Steps 6–10 touch only auth screens:
**the frozen Sahel design is not reopened.**

---

## Three decisions before any code

1. **Entrepreneur activation** — build the state machine now and defer
   activation, or wait for iPayMoney?
2. **Referral programme** — confirm it is a separate milestone.
3. **Email provider** — which one, or proceed with console-only and add the
   adapter later?

---

## 17. Implementation record

Written after the code, from the code. Where this section and an earlier one
disagree, this one is what runs.

### 17.1 What shipped

| Layer | Files |
| --- | --- |
| Migration | `packages/db/migrations/0016_email_password_auth.sql` |
| Schema | `packages/db/src/schema/identity.ts` (`users.programme`, `programme_subscriptions`, widened `otp_purpose_valid`) |
| Domain — codes | `packages/core/src/auth/email-identity.ts` |
| Domain — programmes | `packages/core/src/programme/index.ts` |
| Limits | `packages/core/src/ratelimit/index.ts` (`perEmailPerHour`, `emailSendRules`) |
| Routes | `apps/web/src/app/api/v1/auth/{email/verify,password/forgot,password/reset,programme}/route.ts` |
| Route helpers | `apps/web/src/lib/email-auth.ts` |
| Screens | `sign-up`, `sign-in`, `password-reset`, `verify-email`, `programme` |
| Components | `SignUpForm`, `SignInForm`, `PasswordResetForm`, `VerifyEmailForm`, `ProgrammeChoice`, `ProgrammeSettings`, `EmailVerificationBanner`, `SignOutButton` |

The migration is additive only. No existing row is rewritten, no account is
deleted, no synthetic `@phone.afrinext.local` address becomes a real one, and
no session is revoked by the change itself.

### 17.2 Two things the proposal got wrong about Better Auth

Both were found by writing the integration test against the real instance
rather than against my reading of the configuration, and both would have
shipped a broken signup.

**Signup does not sign anybody in.** `emailAndPassword.autoSignIn` is `false`,
deliberately — consent has not been given at that point, so a session issued by
signup would be a session for an account that resolves to no actor. The
proposal's flow assumed a session existed after `signUp.email` and had the
screen call the programme endpoint next; that call would have answered 401, and
so would the consent fetch after it. The screen now signs in explicitly.

**A duplicate address does not raise an error.** `signUpEmail` on an address
that already exists returns a *success* shape — a user object with
`token: null` — and creates nothing. A caller reading "no error" as "account
created" sails straight past it. The screen now tells the two cases apart the
only way available from outside: it tries the credentials, and reports the
address as taken when they do not work. `email-password.test.ts` pins that the
row count stays at one, that no session is issued, and that the original
password is not overwritten by the second attempt.

### 17.3 Decisions taken during implementation

**Issuance limits are policy, not literals.** The first draft carried
`limit: 5` inline. That is the defect review decision 7 already ruled on for
SMS, so the email rules moved into `ratelimit` as `emailSendRules()` reading a
new `perEmailPerHour` field on the stored OTP policy. Changing a limit stays an
`UPDATE`, not a deploy. The field is separate from `perPhonePerHour` because an
SMS costs money per send and an email spends the sending domain's reputation —
same order of magnitude, different reason to move.

**The limit is consumed before the address is judged.** Limiting only real,
reachable addresses would make the limiter the oracle that the identical
answers exist to close: an attacker learns which addresses exist by seeing
which ones eventually answer 429. Unparseable and synthetic addresses burn
budget too.

**There is no `activateSubscription()`.** `active` is declared in the state
machine and is unreachable from application code. No payment provider is
implemented — iPayMoney is confirmed and its adapter throws rather than
pretending — so anything that could set `active` today would set it because a
button was pressed. `programme.test.ts` asserts that nothing this milestone
exposes can reach it, which is the guard against a later change adding one
quietly.

**`audit.targetId` is `users.id`, never Better Auth's text id.** A log where
the same person is two different identifiers depending on which module wrote
the row is a log nobody can follow. `domainUserId()` does that join, and
returns an empty object rather than dropping the audit entry when the link is
missing.

### 17.4 Test results

| Suite | Result |
| --- | --- |
| `packages/core` (whole suite) | **39 files, 735 passed, 20 skipped, 0 failed** |
| `email-identity.test.ts` | 27 passed |
| `programme.test.ts` | 20 passed |
| `email-password.test.ts` | 16 passed |
| `packages/i18n` | 14 passed (catalogue parity, placeholders, plurals) |
| `pnpm lint` | clean, `--max-warnings 0`, all six packages |
| `e2e/email-auth.spec.ts` | 8 passed |
| `pnpm test:e2e` (whole browser suite) | **54 passed** |
| `pnpm typecheck` / `pnpm build` | clean |

Note for anyone re-running these: the suite truncates the tables it touches, so
two `vitest` runs against the same `TEST_DATABASE_URL` at once deadlock each
other and produce failures in `ledger/concurrency`, `content/storage-
equivalence` and `payments/ipaymoney-replay` that have nothing to do with the
code. Run one at a time.

### 17.5 What is still missing before production

1. **No email provider.** `ConsoleSender` is what runs, and it refuses
   `NODE_ENV=production` without `ALLOW_CONSOLE_SENDER=yes`. Verification and
   reset codes are exercised end to end in development, CI and preview by
   reading the server log; **they reach no real inbox**. Decision 3 in section
   13 is still open, and nothing here should be described as "email working"
   until an adapter exists against a provider's real API.
2. **No payment for the Entrepreneur programme.** A subscription can only be
   `pending_payment`. Section 11 stands.
3. **Existing phone accounts still have no address.** Nothing backfills one,
   deliberately. Adding one is a screen those people use when they choose to,
   not a migration.
