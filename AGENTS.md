# Afrinext

African commerce and learning platform, operated by **AFRI NEXT TECHNOLOGIE**
(Entreprise Individuelle, Niger). Launch market Niger, launch currency XOF —
both are data, never constants.

TypeScript monorepo: Next.js 16 web app plus framework-free domain packages,
PostgreSQL, Drizzle.

## Layout

```
apps/web/          Next.js 16 App Router — UI, route handlers. The only place Next.js exists.
packages/core/     Domain logic, framework-free: money, ledger, authz, auth,
                   ratelimit, commissions, consent, audit, payments
packages/db/       Drizzle schema, migrations, client
packages/ui/       Design tokens and shared components
packages/i18n/     fr/en catalogues (fr is the default)
packages/config/   Shared tsconfig and eslint base
docs/              Architecture, review packets, provider gaps
```

## Commands

```bash
pnpm install
pnpm db:migrate                       # apply migrations
pnpm --filter @afrinext/core seed     # reference data, permissions, roles
pnpm dev                              # web app on :3000
pnpm lint                             # eslint, must be clean
pnpm typecheck                        # tsc --noEmit across the workspace
pnpm test                             # vitest, includes DB integration tests
pnpm build                            # production build (also typechecks)
```

Copy `.env.example` to `.env` first. `TEST_DATABASE_URL` must differ from
`DATABASE_URL` — the suite truncates every table it touches and refuses to run
otherwise.

## Rules that are not negotiable

- **`packages/*` never imports Next.js.** Enforced by an eslint rule, not by
  discipline. It is what keeps the ledger testable in milliseconds without a
  server, and makes a future API service a repackaging rather than a rewrite.
- **Money is `bigint` minor units plus a currency code.** Never a float, never a
  bare number. The minor-unit exponent comes from the `currencies` table: XOF
  and XAF have **zero** decimals, so dividing by 100 is wrong across the whole
  UEMOA zone.
- **The ledger is append-only and double-entry.** Correct a mistake by posting a
  compensating transaction; never edit or delete. Database triggers enforce
  this, so a bypass fails loudly.
- **`account_balances` is a cache, never the truth.** The truth is
  `sum(direction * amount_minor)`. Reconciliation compares them.
- **Every money-moving operation takes an idempotency key.**
- **Authorization goes through `authorize()` in `packages/core/authz`.** Scope
  queries to the actor in SQL; never fetch a row then check ownership.
- **Nobody approves their own withdrawal.** Enforced in code, not policy.
- **The ledger records entitlement, not custody.** No screen or field calls a
  seller balance a deposit or protected funds — see blueprint section 01.
- **Locks are taken in a deterministic order.** `postTransaction` sorts the
  balance rows it touches by account id before touching any of them. Without
  that, two transfers in opposite directions deadlock. Anything new that locks
  more than one row follows the same rule.
- **Fee snapshots are frozen and append-only.** A `fee_schedules` row plus its
  `fee_lines` are written once, must total the gross, and are never edited —
  changing a commission rule later must not restate a past order.

## Authentication and authorization

Better Auth owns **authentication only**: credentials, sign-in, sessions. It is
never given a say over authorization.

- Its four tables (`user`, `session`, `account`, `verification`) are declared in
  `packages/db/src/schema/better-auth.ts` and created by **our** migrations, so
  they are diffed and rebuilt from zero in CI like everything else.
  `auth/schema-drift.test.ts` fails if Better Auth's expectations drift from
  what we declare.
- It reaches PostgreSQL through the `pg` Pool, not its Drizzle adapter — the
  adapter would own the tables.
- `session` is the **only** session store. `users.auth_user_id` links a
  credential to the Afrinext identity that roles, consent, audit and ledger
  accounts are keyed on.
- `resolveActor()` in `auth/session-bridge.ts` turns a session into an identity
  and nothing more. Permissions still come from `authorize()`.
- **OTP issuance is rate limited, not just OTP attempts.** Bounding attempts
  alone protects nothing if codes can be requested without limit — and every SMS
  costs money. `packages/core/ratelimit` counts in PostgreSQL with one atomic
  statement. A refusal leaves the auth handler as a **429 with `Retry-After`**,
  never a 500. The limits come from `platform_settings`, not from literals.

## One-time codes

**A verification code exists in exactly one place: `otp_challenges.code_hash`.**

- Better Auth's `phoneNumber` plugin is **not installed and must not be**. It
  writes the code to `verification.value` in the clear and offers no hook to
  change that. `phone-otp.test.ts` fails if those endpoints ever reappear.
- The hash is HMAC-SHA256 under a key derived from the application secret
  (`deriveOtpKey`). A plain salted digest of a six-digit code is reversible by
  trying all million inputs; the key is what a stolen table does not contain.
- Three properties are enforced by PostgreSQL, not by application code:
  one live challenge per identifier and purpose (partial unique index), the
  attempt counter (`where attempts < max_attempts`), and single use
  (`where consumed_at is null`).
- **Every verification failure answers identically.** Wrong code, expired code,
  no challenge and exhausted attempts all return the same 400 with
  `auth.otp_invalid`, so the endpoint cannot be used to enumerate accounts. The
  real reason goes to the audit log.
- The code is never logged, never audited, and never returned.
- **Step-up elevation is required** before requesting a withdrawal, changing
  payout details, changing an account phone number, or any administrative action
  that can change where funds are paid.

## Payments

`PaymentProvider` in `packages/core/src/payments` is the abstraction. `mock` is
implemented and refuses to load in production. **iPayMoney is confirmed as the
provider but NOT implemented** — its documentation is not available, so the
adapter throws rather than pretending. See `docs/providers/ipaymoney/README.md`
for exactly what is required to build it.

No SMS provider is chosen either. `MessageSender` is the whole surface, and a
provider is selected only after a real handset delivery test on Airtel, Orange
and Moov in Niger — see `docs/providers/sms/README.md`.

## Handoff

**Every milestone ends with a review PDF.** Work is reviewed by a senior
developer who reads PDFs, not the repository, so a milestone is not delivered
until its note exists as a file they can open.

- Write the note as `docs/review/<phase>-<milestone>.html`, reusing the visual
  identity of the existing packets in that directory.
- Scale it to the change. A six-file CI job gets a 7-page note; a phase gets a
  packet. A 35-page document about a small diff misrepresents its size.
- It must state: the commit, files changed and why, tests and their exact
  results, the CI run and its result, mutation evidence for anything
  security- or money-critical, open risks, and any decision needed.
- Render it to PDF and send the file. `docs/review/` holds the generator's
  output alongside the HTML.
- Never describe an older note as representing the current state. If the head
  moves, the note is reissued from the new commit.

## Conventions

- Server components by default; `"use client"` only for interactivity.
- Colours come from tokens in `packages/ui/src/tokens.css`. No hex in components.
- Mobile first: layout capped at `max-w-md`, fixed bottom tab bar,
  `env(safe-area-inset-*)` rather than hard-coded offsets.
- Search and filter state lives in URL params so results are linkable.
