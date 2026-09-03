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
| `packages/core` (whole suite) | **39 files, 736 passed, 20 skipped, 0 failed** |
| `email-identity.test.ts` | 28 passed |
| `programme.test.ts` | 20 passed |
| `email-password.test.ts` | 16 passed |
| `packages/i18n` | 14 passed (catalogue parity, placeholders, plurals) |
| Mutation matrix (19 designed) | **19 caught, 0 escaped** — three survived the first pass and are documented in the review packet |
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

---

## 18. The preview bug report, and what it exposed

Reported from `afrinext-preview.onrender.com`: signup works, the verification
screen appears, no code arrives, and the Render log between 07:04:51 and
07:05:31 shows nothing but health checks.

### 18.1 What was actually happening

Reproduced locally under Render's exact configuration — production build,
`NODE_ENV=production`, `ALLOW_CONSOLE_SENDER=yes` — and measured rather than
reasoned about:

```
POST /api/v1/auth/email/verify -> 200  {"sent":true}     ← at SIGNUP
   (no API call at all when /verify-email loads)
POST /api/v1/auth/email/verify -> 429  retryAfterMs 46176 ← the RESEND
```

Server log for the whole session, in full:

```
{"level":"info","msg":"domain user provisioned",...}
[ConsoleSender] NOT DELIVERED — would send to diag@example.com: … : 495050
```

**No email will ever arrive: no provider is configured.** That part is section
17.5 item 1, working as documented. The code is written to the log — *at
signup*, which is not the moment the log was being watched.

Two things made that indistinguishable from a broken sender, and two more were
found alongside them.

### 18.2 D1 — every refusal in this module was silent

`issueAndSend` returned `limited(verdict)` with no log and no audit; so did the
route's 401, already-verified and unreachable-address exits. Six consecutive
429s produced **zero** log lines. Meanwhile `guardedSend` on the phone path has
logged *and* audited refusals since Phase 1 — I wrote two refusal paths and
instrumented one.

Fixed by `recordRefusal()`: a structured `warn` and an
`auth.email.rate_limited` audit row carrying `reason`, `used`, `limit` and
`retryAfterMs`. The address is masked (`a****@example.com`) — a log line is a
copy of the data under different access rules and a different retention, and
the domain is the only part operations needs. The code is never recorded.

### 18.3 D2 — the screen claimed a send it had not made

`/verify-email` opened with *"Nous avons envoyé un code à X"* unconditionally.
The page issues nothing; that was a claim about an event on another screen,
which it could not know had happened and would have been wrong about after a
refused send. It now names the address, asks for the code, and reports whether
one is genuinely outstanding — `hasLiveChallenge()` asks the database.

It still sends nothing on load, deliberately. An automatic send would spend one
of the five an hour every time somebody re-read the screen, and the cooldown
would then refuse the resend they actually meant to make.

### 18.4 D3 — five presses spent the hour and issued nothing

Measured, before the fix:

```
press 1: 429 Retry-After 8      press 4: 429 Retry-After 4
press 2: 429 Retry-After 6      press 5: 429 Retry-After 2703  ← 45 minutes
press 3: 429 Retry-After 5
```

`consumeAll` stops at the first refusal and `consume` counts refused requests
too — deliberate, so hammering a blocked bucket cannot drain it early. With the
hourly per-address cap ordered *first*, a cooldown refusal therefore also spent
one of the five sends. Signup (1) plus five presses (5) exhausted the hour
without a single code being issued.

The order is now **IP → cooldown → hourly**:

| Rule | Why it sits there |
| --- | --- |
| per IP, hourly | The flood gate, and it now counts every attempt including ones the later rules refuse. **Strictly stronger than before**, when an address-level refusal returned before the IP bucket was ever touched — so flooding one address from one connection used to cost nothing per-IP. |
| cooldown, 1 per window | Refuses a too-early resend *without reaching the hourly rule*. |
| per address, hourly | Reached only by a request that will actually issue a code, so the five are five codes rather than five button presses. |

**No limit was raised.** What changed is which bucket a refused request pays.

The wait now reaches the person: `postJson` keeps `retryAfterMs` and falls back
to the `Retry-After` header, the resend button is disabled while it runs down,
and a `aria-live="polite"` region counts the seconds off a wall-clock deadline
rather than a decremented counter — a backgrounded mobile tab does not receive
its intervals on time, and drift there means telling somebody to keep waiting
after the server has stopped refusing.

### 18.5 D4 — the signup send was fire-and-forget

`void requestEmailVerification()`. Blocking nothing and telling nobody are
different things. It is awaited now; a failure no longer leaves somebody on a
screen announcing a code that was never sent, because that screen reads the
real state. Verification still gates nothing.

### 18.6 Why the existing tests missed all four

The unit test `holds a resend cooldown between consecutive sends` asserts the
429 arrives — so the *behaviour* was tested and the *observability* was not; a
guarantee about logging cannot be checked by looking at a return value.

The browser test was worse: it takes its log mark **before** signup precisely
because the code is sent there and the resend would meet the cooldown, and the
comment in `email-auth.spec.ts` says so. It **encoded** the trap instead of
questioning it, and never pressed the resend button at all. The three new
browser tests do press it, at the reviewed production limits, and one of them
waits the cooldown out and resends for real.

### 18.7 Results at this head

| Suite | Result |
| --- | --- |
| `packages/core` | **39 files, 747 passed, 20 skipped** (12 new) |
| `pnpm test:e2e` | **57 passed** (3 new) |
| Mutation matrix D1–D4 | **13 designed, 13 caught, 0 escaped** |
| lint / typecheck / build | clean |

No migration. No provider connected. No limit relaxed. No Origin or CSRF
protection touched. `APP_URL` unchanged. Ledger, wallets, payments, iPayMoney
and referral untouched.

---

## 19. Brevo, and the interface split it forced

### 19.1 Where the contract came from

`developers.brevo.com` **and** `api.brevo.com` are both blocked by this
environment's egress proxy (`CONNECT … 403`, verified). So the endpoint, the
header name, every body field and the retry semantics were read out of Brevo's
own published PHP SDK — `github.com/getbrevo/brevo-php`, SDK **5.0.2**, commit
`1b371f9` — code Brevo generates from its own specification:

| Fact | File in the SDK |
| --- | --- |
| `https://api.brevo.com/v3` | `src/Environments.php` |
| `POST smtp/email` | `src/TransactionalEmails/TransactionalEmailsClient.php` |
| header `api-key` | `src/Brevo.php` |
| `sender`, `to`, `subject`, `textContent`, `htmlContent`, `replyTo`, `headers` | `…/Requests/SendTransacEmailRequest.php` |
| `messageId`, `messageIds` | `…/Types/SendTransacEmailResponse.php` |
| `{ code?, message }` | `src/Types/ErrorModel.php` |
| retries on 408/429/5xx; **no default timeout** | `README.md` |

A web search suggested `/v3/smtp/emails` for sending. It is not: that path is
the **GET** that lists sent mail. Reading the source is what settled it, and it
is exactly the ambiguity that guessing would have shipped.

**What the SDK does not state is not guessed here.** The exact success status is
not asserted — the SDK treats 2xx and 3xx alike, and so does the adapter — and
neither is the body of a 401. **No request has ever been sent to Brevo from
this codebase.**

### 19.2 The interface splits by channel

`MessageSender` carried `sendSms` and `sendEmail`, and one instance served both
the email flow and — through `createAuth` — the **phone OTP flow, which is the
launch path in Niger.** A single Brevo sender would have had to answer for
`sendSms`, and the only honest answer is a throw, which takes phone sign-in
down in production.

```
EmailSender { sendEmail }        ← BrevoSender, ConsoleSender
SmsSender   { sendSms }          ← ConsoleSender only; no provider chosen
MessageSender extends both       ← unchanged for every existing call site
CompositeSender                  ← pairs them; id "email:brevo/sms:console"
```

`EmailAuthDeps.sender` narrowed to `EmailSender`: that module has never sent an
SMS, and asking for the ability would be asking for something it must not use.

### 19.3 Decisions inside the adapter

- **The timeout is required, not optional.** The SDK configures none and says
  so; an unbounded call sits inside the signup path holding somebody on a
  spinner for as long as the socket stays open. Default 10 s.
- **The 70-character sender name is checked at construction.** The limit is
  Brevo's. Discovering it at send time means every code silently failing, for
  every account, until somebody reads a log — so it stops the process starting.
- **`Idempotency-Key` carries the challenge id.** `issueChallenge` retires any
  live code and inserts exactly one row, so one id means one code means one
  message. A retry after a lost response then delivers one email rather than
  two working codes minutes apart.
- **`textContent` and `htmlContent` both.** One line of text either way; the
  HTML part exists because a multipart message is treated better by spam
  filters, and a code in a spam folder is indistinguishable from one never sent.
- **Nothing sensitive leaves.** The thing being sent IS a secret. The error
  message is fixed text; only Brevo's `code` and `message` are read from a
  failure, so an unexpected field cannot smuggle anything into a log; the
  address is masked; and a transport failure is reduced to its error *name*
  before it is written, because a fetch failure can carry the request and the
  request carries the code.

### 19.4 Verified locally, in the production configuration

`NODE_ENV=production`, `EMAIL_PROVIDER=brevo`, a placeholder key, one process:

```
{"level":"error","msg":"brevo refused the message","component":"auth.email.brevo",
 "status":403,"brevoCode":null,"brevoMessage":null,"to":"b*********@example.com"}

[ConsoleSender] NOT DELIVERED — would send to +22795835464: Afrinext: 944867
```

The first line is the adapter meeting the egress proxy's 403 and handling a
non-JSON error body without inventing one. The second is **the phone channel
still working in the same process** — the whole reason the interface split.

Grepped over the entire log: the API key appears **0** times, the full address
**0** times, and no verification code at all.

The screen answers `400 email.delivery_failed` with the fixed message. The
challenge row survives, deliberately: a failure after the bytes left the
process is not proof that nothing was delivered — the same reasoning the refund
policy applies to money — so the code stays valid and the neutral wording from
§18.3 stays true either way.

### 19.5 Results

| Suite | Result |
| --- | --- |
| `packages/core` | **41 files, 781 passed, 20 skipped** (34 new) |
| `pnpm test:e2e` | **57 passed** — phone sign-in unaffected |
| Mutation matrix | **20 designed, 19 caught, 1 no-op** (see below) |
| lint / typecheck / build | clean |

Two mutations are worth recording rather than hiding in a score.

**G6 survived the first pass.** Replacing `idempotencyKey: challenge.challengeId`
with `undefined` broke nothing: `ConsoleSender` ignores the field, so every test
in the file passed whether or not the key was threaded, and the adapter tests
only proved the adapter sends a key it is handed. A recording sender now
compares the key against the row the challenge store wrote.

**G11 is a no-op, and it took me two attempts to see it.** Giving
`EmailDeliveryFailedError` an optional `detail` parameter that no call site
passes changes nothing observable — that is not a surviving defect, it is a
badly designed mutation. G11b expresses the same property properly, throwing
with the status, Brevo's message and the address, and it is caught by six tests.

**G12 first reported PATTERN NOT FOUND**, which was an artifact of my own
harness: a run killed by a command timeout had left a mutation applied in the
worktree. Re-run against a clean tree it is caught. Worth knowing before
trusting a resumed matrix.

No migration. No real credential in the repository — the only `xkeysib-` strings
are the test server's fixed placeholder and the wrong-key case.

### 19.6 What only a real account can prove

The success status code, the 401 body, the account's rate limits, and what
happens when the sender's domain is not verified. None of it is reachable from
here, and none of it is asserted.
