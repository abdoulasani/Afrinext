# Architecture

`blueprint.html` is the Phase 1 technical blueprint — the full document, published as an
artifact at <https://claude.ai/code/artifact/5b36e98c-2699-4dad-a6ed-53efafdd7f7f>.

This file is the short index: the decisions that shape everything else, and the questions
still open. Change a decision here and the blueprint needs updating with it.

## Status

Architecture only. **No code from this plan has been written**, no provider account exists,
and the iPay integration is not designed against — it is blocked on official documentation.
The current application in this repository is a directory prototype with an in-memory store;
only its UI layer carries forward.

## Decisions

| # | Decision | Rationale in short | Contested? |
| - | -------- | ------------------ | ---------- |
| 1 | Launch vertical is digital products + courses, one country, one payment rail | Exercises every hard part except logistics; shortest path to a real settled transaction | Recommendation — needs sign-off |
| 2 | Domain logic lives in `packages/core`, framework-free | Next.js is transport, not the application; makes the ledger testable in milliseconds and a future API extraction a packaging change | No |
| 3 | PostgreSQL, with financial invariants enforced in the database | Deferred constraint triggers, revoked grants and CHECK constraints, not application discipline | No |
| 4 | Drizzle ORM | SQL-first migrations reviewable before they touch money; native CHECK constraints | **Yes** — Prisma is the alternative; decided by team composition |
| 5 | pg-boss over BullMQ + Redis | A job can be enqueued in the same transaction as the ledger rows it will act on | Revisit above ~100 jobs/sec |
| 6 | Double-entry ledger; balances are a verified cache | Immutable entries, per-transaction balancing, nightly reconciliation | No |
| 7 | Pending vs available are two accounts, not a status | Settlement becomes a transfer, answerable by pointing at a ledger row | No |
| 8 | Money is `bigint` minor units + currency; exponent from the `currencies` table | XOF/XAF have **zero** decimals; assuming "cents" is wrong across all of UEMOA | No |
| 9 | Commission rules resolved once at order creation and frozen in `order_fee_lines` | Rate changes never rewrite history | No |
| 10 | Referral is single-level, drawn from platform revenue, paid only on settled transactions | Payout is bounded by definition; keeps the model explainable to a regulator | Recommendation — needs sign-off |
| 11 | Database sessions, not JWTs; phone OTP primary | A session controlling a wallet must be revocable in one query | No |
| 12 | Roles are scoped rows; no `role` column on `users` | One account, many roles, without a schema change per role | No |
| 13 | Postgres in `eu-west-3` (Paris), not `af-south-1` | Better round-trip to West Africa — **assumption, measure in P0** | Unverified |

## Build order

Phases are ordered by irreversibility, not visibility. The money spine (P1) ships before any
product feature, and P3 closes the full economic cycle with a manual payment rail so that no
other phase is blocked on iPay.

`P0` foundations → `P1` ledger → `P2` stores & catalog → `P3` cycle closed, no PSP →
`P4` iPay *(gated)* → `P5` Learn → `P6` wallet & payouts → `P7` network → `P8` physical &
delivery → `P9` services → `P10` hardening

The admin console is not a phase; each phase ships the admin surface for what it built.

## Open questions

Blocking:

1. **Regulatory** — who is advising on whether Afrinext may hold and disburse user funds?
   Gates P6 and may reshape the wallet's legal model.
2. **Launch scope** — digital-and-courses first, or physical goods at launch?
3. **iPay** — is the contract signed, and can we obtain the documentation and sandbox
   credentials listed in section P of the blueprint?
4. **Referral levels** — confirm single-level.

Non-blocking, settle during P0: launch country and currency, team composition (decides #4
above), hosting preference, native app requirement, cash on delivery, KYC provider.
