# Afrinext

An African commerce and learning platform: sell digital products and courses,
build a storefront, get paid, and pay partners — starting in Niger.

Operated by **AFRI NEXT TECHNOLOGIE** (Entreprise Individuelle, Niger).

> **Status: Phase 0 — foundations.** The production foundation is in place:
> database, migrations, authentication core, scoped permissions, versioned
> consent, audit log, and a double-entry ledger with property tests. The
> marketplace, courses, checkout and delivery are **not built yet**. The app
> currently served is the original directory prototype, kept running while the
> real product is built underneath it.
>
> iPayMoney is the confirmed payment provider but is **not integrated** — see
> [`docs/providers/ipaymoney/README.md`](docs/providers/ipaymoney/README.md).

## Getting started

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL and TEST_DATABASE_URL
pnpm db:migrate
pnpm --filter @afrinext/core seed
pnpm dev                      # http://localhost:3000
```

Requires Node 22+, pnpm 10+, PostgreSQL 16+.

Check it came up: `curl localhost:3000/api/health`

## Verifying

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

The test suite needs a reachable PostgreSQL and a `TEST_DATABASE_URL` distinct
from `DATABASE_URL`; it truncates every table it touches.

## Documentation

| Document | What it is |
| -------- | ---------- |
| [`docs/architecture/README.md`](docs/architecture/README.md) | Decision index — start here |
| [`docs/architecture/blueprint.html`](docs/architecture/blueprint.html) | Full technical blueprint (also as PDF) |
| [`docs/review/`](docs/review/) | Per-phase review packets for sign-off |
| [`docs/providers/ipaymoney/README.md`](docs/providers/ipaymoney/README.md) | What the payment integration still needs |
| [`AGENTS.md`](AGENTS.md) | Working rules for this codebase |

## Layout

```
apps/web/          Next.js 16 — the only place Next.js exists
packages/core/     Domain logic, framework-free
packages/db/       Drizzle schema and migrations
packages/ui/       Design tokens and shared components
packages/i18n/     fr / en catalogues
packages/config/   Shared tsconfig and eslint base
```
