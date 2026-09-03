# The digital product engine

**Status: implemented.** A buyer pays for a file. The seller later uploads a
corrected one. Whatever else happens, the bytes that buyer paid for and the
terms they agreed to must still be exactly what they were when money moved.

A receipt that can be edited afterwards is not a receipt.

## What Phase 5 added

The end-to-end path already worked: create a digital product → price it in XOF
→ publish → buy → mock payment → paid → buyer downloads. Phase 5 did not
rebuild it. It added the four things that make it a product rather than a demo:
**versions**, **licences**, **download limits**, and a **library**.

It also connected two things that already existed and had never been introduced
to each other: the refund domain, and entitlement revocation.

## Versions

```
products                 product_versions              digital_assets
   id ──────────────────< product_id                       │
                          version_no  1, 2, 3 …            │
                          licence_text                     │
                          status      draft | published    │
                          id ──────────────────────────────< version_id

entitlements
   version_id ──────────> the version this buyer PAID for
   licence_snapshot ────> a COPY of its licence, taken at payment
```

Files and licence text belong to a **version**, never to the product. A version
is editable while `draft` and immutable once `published`.

### Review decision 1 — pinned, with newer versions visible

A buyer is entitled to **exactly the version they paid for**, and is **told**
when the seller has published a newer one.

Both halves are load-bearing, and either one alone is a different product:

- **The pin without the notice** is silent staleness. A buyer cannot tell an
  out-of-date file from an abandoned product, and the seller can quietly change
  what was sold by publishing over it.
- **The notice without the pin** is an automatic upgrade nobody agreed to.
  Afrinext has decided no such commercial policy, and licences and refunds both
  depend on knowing which version a purchase refers to.

`EntitledProduct` and `LibraryEntry` therefore carry **two** numbers:

| Field | Means |
|---|---|
| `versionNo` | the version this buyer owns, from `entitlements.version_id` |
| `latestVersionNo` | the seller's current published head, from a correlated subquery |

They are separate columns on purpose: one is a fact about the purchase and the
other a fact about the product, and a single field would eventually be read as
both. A **draft** version is never counted as newer, because nobody can buy it.

The library says so in the seller's absence of ambiguity: *"Vous conservez la
version 1, celle que vous avez achetée. Afrinext n'accorde pas automatiquement
les nouvelles versions."* An explicit upgrade path is possible later; it is not
implied now.

### Immutability is the database's job

Not a convention, not a code path — four triggers:

| Guarantee | Mechanism |
|---|---|
| A published version's licence, number and status cannot change | `reject_published_version_change()` |
| A published version cannot be deleted | same trigger, `DELETE` branch |
| The file set of a published version is frozen | `reject_published_asset_change()` on INSERT, UPDATE **and** DELETE |
| The download log cannot be rewritten or erased | `reject_mutation()` + `REVOKE UPDATE, DELETE` |

The version trigger is conditional on the row *already* being published, because
an unconditional append-only trigger would also forbid the `draft → published`
transition. The asset trigger looks up its version's status, so a file cannot be
added to, edited in, or removed from a version somebody has paid for — even by
code that has not been written yet.

`digital-engine.test.ts` asserts all four against **raw SQL**, bypassing every
domain function, because that is the only way to test a guarantee that is meant
to hold against future code.

### A new upload never replaces a purchased file

`attachAsset` writes into the product's draft version, opening one if there is
none. Several uploads collect into *one* draft rather than a version each — a
seller adding three files gets version 2 with three files in it, and the partial
unique index `product_versions_one_draft` makes that safe under a double-click.

### The buyer is pinned to what they bought

```sql
and a.version_id = e.version_id
```

One line in `resolveEntitledAsset`, and the whole guarantee rests on it. Without
it, publishing version 2 would silently hand every past buyer the new files, and
retiring a version would take away what they paid for.

**A buyer is not automatically granted later versions.** That would be a
commercial policy — "free updates for life" — and Afrinext has not decided one.
Inventing it would be inventing a term of sale. The entitlement names version 1
and keeps naming it.

### Publishing a product publishes its version

`publishProduct` promotes the pending draft and **refuses when there is nothing
to deliver**. A digital product published with no files would take a buyer's
money and hand back an empty page — the same dishonesty as a placeholder file,
arriving by omission instead. The two lifecycles are tied together in one place
rather than left to a seller remembering to do both.

## Licences

The seller's own words. Afrinext writes none, supplies no default, and makes no
legal claim of its own. Where a seller has stated nothing, every surface says
so rather than implying terms that do not exist.

| Where | What is shown |
|---|---|
| Public product page, **before** the buy button | the current published version's licence |
| Library product page, after purchase | `entitlements.licence_snapshot` |

The snapshot is a **copy, not a join**. The version's licence is already
immutable, so a foreign key would have been nearly as good — but copying means
the buyer's terms survive a future migration that reorganises versions, and it
makes "what did this person agree to?" answerable from one row.

## Download limits

`products.download_limit`, `null` meaning unlimited.

### Review decision 2 — per file, per buyer

Each file carries its own allowance. A product containing `guide.pdf`,
`templates.zip` and `bonus.mp4` with a limit of 5 gives the buyer five
downloads **of each**, not five across the three — a three-file product should
not exhaust its allowance by being fetched once, and "you can download each file
up to 5 times" is a sentence a seller can say to a customer without a footnote.

Mechanically this is the scope of the count: `entitlement_downloads` is counted
over `(entitlement_id, asset_id)`, so one file's history cannot spend another's.

### Counted, never stored

```sql
CREATE TABLE entitlement_downloads (...);          -- one row per delivered file
CREATE TRIGGER entitlement_downloads_append_only   -- UPDATE and DELETE refused
REVOKE UPDATE, DELETE ON entitlement_downloads FROM afrinext_app;
```

"Downloads remaining" is `limit − count(rows)`. There is no counter to
decrement and therefore none to reset: resetting one would mean deleting
evidence, and `DELETE` is refused at the database. A test proves it by trying.

The count is over **all** downloads, ever. A mutation that windowed it to the
current day survived the entire first matrix — every test downloads twice within
a second, so a limit silently resetting at midnight would have passed all of
them. The test that kills it back-dates a download by a year.

### Checked at delivery, recorded after success

The limit is enforced in `openContent`, where the bytes are handed over — not at
grant time. Minting a grant is an intention; what a seller limits is how many
times the file leaves Afrinext. A buyer who opens the page twice and downloads
once has spent one.

The row is written **after** storage returns the bytes, so a storage failure
does not spend a buyer's download. There is a test for that too.

### The one refusal allowed to say what it means

Every content refusal collapses into `ContentForbiddenError` — "no such asset",
"not yours", "expired grant", "revoked", "not published" are one message, so the
endpoint cannot be used to enumerate assets or other people's purchases.

`DownloadLimitReachedError` is the exception, and it is safe because it is only
reachable by somebody who has **already** proved a live entitlement to that
exact file. Telling them they have used their five downloads discloses a fact
about their own purchase, to them, and leaves them able to act on it. A prober
never reaches it: they are stopped one check earlier, opaquely, having proved
nothing.

The route answers **429**, not 403 — the request was legitimate, and the answer
is about exhaustion rather than permission.

## Access: three checks, and none of them is a claim

Unchanged from Phase 2 in shape, extended in Phase 5 by the version pin and the
limit:

```
  1. a short-lived HMAC grant, signed under a key derived from the app secret
  2. actor.userId === the subject the grant was issued to
  3. a fresh SQL lookup: entitlement live, version matches, product published,
     store published — read from the database, never from the grant
  4. the download allowance, counted
```

The third is what makes the first two safe to exist. A grant is a convenience,
not an authority: leaked, it is useless to anyone else because of (2), and
useless to its owner after a revocation because of (3).

### What never reaches the browser

Storage keys. The `ContentStorage` port returns **bytes, not locations**, and a
browser test asserts the key does not appear in the page source. There is no
public file URL to guess, enumerate or share, because there is no file URL at
all.

## Storage

`packages/core/src/content/storage.ts`, unchanged by Phase 5 and deliberately
so — §11 asked for the existing abstraction to be used rather than a new
provider introduced for convenience.

| Adapter | Where |
|---|---|
| `InMemoryContentStorage` | tests |
| `FilesystemContentStorage` | local development and the browser suite |

**No cloud storage is configured, and none is pretended.** An object store's
pre-signed URL would be a perfectly good adapter for `open()`, built *inside* an
implementation of this port where the entitlement check has already happened and
with a lifetime measured in seconds. That is a deployment decision, not a code
one, and it is not made here.

## Entitlements, and what ends them

| Event | Effect |
|---|---|
| Payment reaches `paid` | entitlement granted, pinned to the published version, licence copied |
| Product unpublished | access stops on the next request |
| Store suspended | access stops on the next request |
| **Refund reaches `succeeded`** | **entitlement revoked** |

The last one is new. `revokeEntitlement` existed since Phase 2 and had no
caller — Phase 2 correctly declined to invent a refund policy. Phase 3 defined
one. Phase 5 connects them.

`revokeEntitlementsForOrder` is keyed on the **order**, not on a buyer and a
product, so it cannot revoke somebody else's purchase of the same product and
needs no caller-supplied user id. It is called from **both** places a refund can
reach `succeeded` — the execution path and the provider-resolution path — via
one helper, because two code paths that both decide "the money went back" must
agree about what that means for the goods.

### Review decision 3 — revoke on a FULL refund only

    money completely returned  ->  digital entitlement revoked
    money partly returned      ->  entitlement remains

Two conditions, and both are necessary.

**Only `succeeded`.** A refund that failed, or whose outcome we never learned
(`in_doubt`), leaves access exactly as it was: taking a buyer's file away on a
refund that did not actually pay them is the worst of both outcomes — they have
neither the money nor the goods.

**Only a full refund.** A partial refund is a price adjustment, not an undoing
of the sale. A seller who returns 1 000 of a 5 000 XOF purchase because one file
was missing has not taken the product back, and revoking on it would punish a
buyer for complaining.

The rule lives in `refundRevokesAccess()` in `refunds/state.ts` as a predicate
over amounts, not as a branch inside the refund executor, and that placement is
the interesting part. **Afrinext cannot execute a partial refund today**: two
unique indexes allow one refund per order and per payment, and the executor
refuses an amount its payment does not corroborate. So without a predicate the
partial branch would be a line of code no test could reach — until the day it
started deciding what happens to somebody's purchase. Both guards are asserted
by a test, so when partial refunds arrive that test fails and points here.

The amount compared is the **sum of everything that has succeeded against the
order**, not the refund in hand: three settled refunds of 2 000 against a 6 000
order have between them returned the whole price and must revoke.

Afrinext's position is that a buyer who has been repaid is no longer entitled.
The file they already downloaded cannot be recalled; their continuing access
can be, and is.

## The buyer's library

`/[locale]/library` — a real screen and a nav tab, where before there was only
a per-product page reachable if you already knew the URL.

Every row comes from `listEntitledProducts`: a join from the session's actor
through a live entitlement. There is **no user id, order id or "owned" flag
anywhere in the request**, and nothing is read from the browser. The only way a
product appears is that this person paid for it and has not been refunded.

Each row shows the truth about the **purchase**, not the product's current
state: the version bought, whether a licence was agreed, how many downloads
remain, what was paid, and when. A seller publishing version 2 tomorrow changes
none of it — and the library says that version 2 exists, which is review
decision 1 rendered on the one screen where it matters.

## The financial boundary

**This milestone moves no money and posts nothing to the ledger.** Not
implemented and not started: settlement, seller payouts, wallet movements,
commission payment, referral payout, refund *execution* (the Phase 3 domain is
called, not extended), payment capture logic.

iPayMoney remains unimplemented and unreachable from this environment. The mock
provider is the payment provider for tests, and the library screen says on its
face that access being open is not the same as the seller having been paid.

## Files

| Path | What |
|---|---|
| `packages/db/migrations/0015_digital_versions.sql` | versions, assets→version, snapshots, limits, download log, four triggers |
| `packages/core/src/content/versions.ts` | draft/publish, licence, limit, public licence read |
| `packages/core/src/content/access.ts` | grants, version-pinned resolution, limit enforcement, revocation |
| `packages/core/src/content/storage.ts` | the storage port and its two adapters |
| `packages/core/src/content/digital-engine.test.ts` | 28 adversarial tests |
| `apps/web/src/app/[locale]/library/page.tsx` | the buyer's library |
| `apps/web/src/components/ProductDelivery.tsx` | the seller's version, licence and limit controls |
| `apps/web/e2e/digital-engine.spec.ts` | the browser journey and its negative cases |
