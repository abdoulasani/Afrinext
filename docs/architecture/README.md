# Architecture

`blueprint.html` is the Afrinext architecture of record — **revision 2**, updated with the
confirmed business decisions of the Phase 0 authorization. It is published as an artifact and
rendered to `Afrinext-Technical-Blueprint.pdf`.

This file is the short index: the decisions that shape everything else, and what is still open.
Change a decision here and the blueprint must change with it.

## Operator and regulatory posture

Afrinext is operated by **AFRI NEXT TECHNOLOGIE**, an *Entreprise Individuelle* registered in
Niger, holding an NIF and an RCCM, with registered activities including information technology,
artificial intelligence, general commerce, service provision and import-export.

**NIF and RCCM establish company registration. They are not a payment-services or e-money
licence and must never be described as one.** Section 01 of the blueprint separates seven layers
that are routinely conflated:

| | Layer | Established by |
| - | ----- | -------------- |
| A | Company registration | NIF, RCCM |
| B | Contract with users | Versioned consent records |
| C | Payment-provider relationship | iPayMoney merchant account |
| D | Afrinext internal ledger | Double-entry entries |
| E | Seller economic entitlement | Ledger balance + Seller Terms |
| F | Payout operation | Payout workflow + a rail |
| G | **Regulatory authorization** | A licence, an exemption, or operating under a licensed institution |

Nothing in A–F establishes G. Afrinext intends to investigate and obtain whatever authorization
its financial activities require; until then the ledger records **entitlement, not custody**, and
the payout rail sits behind an interface so the posture can change without a rewrite.

## Confirmed decisions

| # | Decision | Rationale in short | Status |
| - | -------- | ------------------ | ------ |
| 1 | Afrinext is the commercial platform of record — receives customer payments, pays beneficiaries under its own terms | Confirmed business model | Confirmed |
| 2 | V1 = digital products + courses. V2 physical + delivery, V3 creator + services | Exercises every hard part except logistics; shortest path to a settled transaction | Confirmed |
| 3 | Launch market Niger, currency XOF — as data, never constants | Multi-country design unchanged | Confirmed |
| 4 | iPayMoney is the initial provider, behind `PaymentProvider` | Merchant account held; a second provider must stay possible | Confirmed |
| 5 | Double-entry ledger is the authoritative financial record | Not to be replaced by a balance field | Approved in principle |
| 6 | Pending vs available are two ledger accounts, not a status | Settlement becomes a transfer you can point at | Confirmed |
| 7 | Money is `bigint` minor units + currency; exponent from the `currencies` table | XOF/XAF have **zero** decimals — assuming "cents" is a 100× error | Confirmed |
| 8 | Commission resolved once at order creation and frozen | Rate changes never rewrite history | Confirmed |
| 9 | Referral single-level; basis is Afrinext's realized commission, never gross | Payout bounded by what the platform earned; no pay for registration or recruitment | Confirmed |
| 10 | Versioned consent per document per user; append-only | Answers "which terms bound this user in March?" | Confirmed |
| 11 | Consent establishes contract (B), never authorization (G) | The line that must not be crossed | Confirmed |
| 12 | Domain logic in a framework-free `packages/core` | Ledger testable without a server; API extraction later is repackaging | Confirmed |
| 13 | Database sessions, not JWTs; phone OTP primary | A session controlling a wallet must be revocable in one query | Confirmed |
| 14 | Roles are scoped rows; no `role` column on `users` | One account, many roles | Confirmed |
| 15 | Drizzle ORM | SQL-first migrations reviewable before they touch money | **Proceeding on recommendation** — genuinely depends on team composition |
| 16 | Postgres in `eu-west-3` (Paris) rather than `af-south-1` | Better round-trip to West Africa | **Assumption — measure it** |

## Build order

Phases are ordered by irreversibility, not visibility. The money spine ships before any product
feature; P3 closes the economic cycle with a manual rail so nothing is blocked on iPayMoney.

`P0` foundations ← **in progress** → `P1` ledger-backed commerce → `P2` stores & catalog →
`P3` cycle closed, no PSP → `P4` iPayMoney *(gated on docs)* → `P5` Learn → `P6` wallet & payouts
*(gated on layer G)* → `P7` network → `P8` physical & delivery → `P9` services → `P10` hardening

## Still open

1. **Regulatory (layer G)** — who is advising, and what authorization is being pursued? Gates P6, long lead time.
2. **iPayMoney documentation** — the 13 items in blueprint section P. Sandbox credentials are the most useful single item.
3. **Team composition** — settles Drizzle vs Prisma.
4. **Hosting** — managed or containers.
5. **SMS provider** for OTP in Niger.
6. **Native app** — is the PWA enough at launch?
7. **KYC provider** and verifiable document types in Niger.
8. **Legal document texts** — a legal deliverable; the consent machinery works with any text.

## PDF

`Afrinext-Technical-Blueprint.pdf` is a print rendition of `blueprint.html`, generated by printing
the HTML through headless Chromium with a print stylesheet — light theme, one section per page,
embedded typefaces, page numbers footed with the source commit. Regenerate it whenever the HTML
changes, or the two will disagree.
