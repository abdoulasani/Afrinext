# Afrinext

African commerce and learning platform, operated by **AFRI NEXT TECHNOLOGIE**
(Entreprise Individuelle, Niger). Launch market Niger, launch currency XOF —
both are data, never constants.

TypeScript monorepo: Next.js 16 web app plus framework-free domain packages,
PostgreSQL, Drizzle.

## Layout

```
apps/web/          Next.js 16 App Router — UI, route handlers. The only place Next.js exists.
packages/core/     Domain logic, framework-free: money, ledger, authz, auth, consent, audit, payments
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

## Payments

`PaymentProvider` in `packages/core/src/payments` is the abstraction. `mock` is
implemented and refuses to load in production. **iPayMoney is confirmed as the
provider but NOT implemented** — its documentation is not available, so the
adapter throws rather than pretending. See `docs/providers/ipaymoney/README.md`
for exactly what is required to build it.

## Conventions

- Server components by default; `"use client"` only for interactivity.
- Colours come from tokens in `packages/ui/src/tokens.css`. No hex in components.
- Mobile first: layout capped at `max-w-md`, fixed bottom tab bar,
  `env(safe-area-inset-*)` rather than hard-coded offsets.
- Search and filter state lives in URL params so results are linkable.
