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
| 17 | Better Auth owns authentication; `authorize()` still owns authorization | A session proves identity and grants nothing | Confirmed |
| 18 | Better Auth's four tables live in our schema and migrations, not its adapter | Reviewed, diffed and rebuilt from zero in CI like everything else | Confirmed |
| 19 | Better Auth's `session` is the only session store; ours was dropped | Two session stores is two truths about who is signed in | Confirmed |
| 20 | OTP **issuance** is rate limited, not only OTP attempts | Unlimited issuance makes attempt limits meaningless, and each SMS costs money | Confirmed |
| 21 | Multi-row locks are acquired in a deterministic order | Found by test, not by reasoning — see the Phase 1 packet, section 10 | Confirmed |
| 22 | Phone verification codes live only in `otp_challenges`, as a keyed hash | Better Auth's phone plugin stored them in plaintext and offers no hook; it is not installed | **Confirmed — decision 1, option (b), implemented** |
| 23 | The OTP hash is HMAC under a key derived from the app secret, not a bare digest | A six-digit code falls to a million-guess loop; the key is what a stolen table lacks | Confirmed |
| 24 | Every OTP verification failure answers identically | Otherwise the endpoint enumerates which numbers have accounts | Confirmed |
| 25 | OTP limits are read from `platform_settings` | Decision 7: limits are configuration; the per-IP limit is the production-tuning point | Confirmed |
| 26 | Step-up is required for withdrawals, payout details, phone changes, and any admin action that moves where funds are paid | Decision 3 | Confirmed — mechanism built, enforcement lands with the payout path |
| 27 | An SMS provider is selected only after a real handset test on all three Niger networks | Decision 8: no provider chosen from documentation alone | Confirmed — investigation not started |
| 28 | Opening a store is gated on the current `seller_terms`, refused in `packages/core` | The blueprint fixes the principle, not the mapping; this is the mapping | Confirmed — milestone 3 |
| 29 | `requireConsent` fails closed: an unresolvable document refuses the action | A missing translation would otherwise switch the gate off silently | Confirmed |
| 30 | The consent locale is read from the user's row, and acceptance resolves the version server-side | A client that names either can walk past the gate or record a meaningless acceptance | Confirmed |
| 31 | Seller eligibility stays a granted role — signing up does not confer it | Gated seller model, per review decision | Confirmed |

## Build order

Phases are ordered by irreversibility, not visibility. The money spine ships before any product
feature; P3 closes the economic cycle with a manual rail so nothing is blocked on iPayMoney.

`P0` foundations ✓ → `P1` money spine ✓ → `P2` commerce vertical ← **in progress, milestones 1–3 of 5 done** → `P1` ledger-backed commerce → `P2` stores & catalog →
`P3` cycle closed, no PSP → `P4` iPayMoney *(gated on docs)* → `P5` Learn → `P6` wallet & payouts
*(gated on layer G)* → `P7` network → `P8` physical & delivery → `P9` services → `P10` hardening

## Still open

1. **Regulatory (layer G)** — who is advising, and what authorization is being pursued? Gates P6, long lead time.
2. **iPayMoney documentation** — the 13 items in blueprint section P. Sandbox credentials are the most useful single item.
3. **Team composition** — settles Drizzle vs Prisma.
4. **Hosting** — managed or containers.
5. **Signup consent** — nobody has accepted `terms_of_use` or `privacy_policy`, because the only
   signup path is the OTP flow and gating it needs approval. Buyers never meet the seller gate at all.
6. **SMS provider** for OTP in Niger — the practical critical path. Requirements and the
   delivery test that decides it are in `docs/providers/sms/README.md`; three candidates named
   for the first investigation, none assumed suitable.
6. **Native app** — is the PWA enough at launch?
7. **KYC provider** and verifiable document types in Niger.
8. **Legal document texts** — a legal deliverable; the consent machinery works with any text.

## Review packets

| Document | Phase | Note |
| -------- | ----- | ---- |
| `review/phase-1.html` | architecture | Written when the architecture brief was itself called "Phase 1" |
| `review/phase-0.html` | Phase 0 — foundations | Corrected: its claim that CI had never run was wrong |
| `review/phase-1-money-spine.html` | Phase 1 — money spine | Closed and approved at `aee5b4c` |
| `review/phase-2-milestone-1.html` | Phase 2, milestone 1 — browser CI | Accepted |
| `review/phase-2-milestone-2.html` | Phase 2, milestone 2 — stores and digital products | Accepted |
| `review/phase-2-milestone-3.html` | Phase 2, milestone 3 — the consent gate | Current |

Each has a `-Review-Packet.pdf` (the packet alone) and a `-For-Review.pdf` (packet plus the
blueprint, bookmarked as two parts).

## PDF

`Afrinext-Technical-Blueprint.pdf` is a print rendition of `blueprint.html`, generated by printing
the HTML through headless Chromium with a print stylesheet — light theme, one section per page,
embedded typefaces, page numbers footed with the source commit. Regenerate it whenever the HTML
changes, or the two will disagree.
