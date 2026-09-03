# The universal store engine

**Status: implemented.** One `stores` table serves six businesses. There is no
`formations` table, no `services` table and no plan to add one.

## Why one entity

A formation academy in Niamey and a mechanic on the Route de Tillabéri need the
same things from Afrinext: an identity buyers can find, a list of what they
offer, a price in XOF, an owner who controls it, and a moderator who can stop
it. What differs is **vocabulary and presentation** — "formations" versus
"prestations", a curriculum versus a call-out radius — not structure.

Six near-identical tables would have to be kept in step forever. Every future
feature — moderation, search, commission, payouts, suspension — would be written
six times, and the sixth copy would be the one with the bug. The type is
therefore a **column**, and the differences live in a presentation layer that
cannot affect a query.

```
                    ┌──────────────────────────────┐
   one query ──────▶│  stores (store_type column)  │◀────── one moderation path
                    └──────────────────────────────┘
                                   │
        ┌──────────┬───────────┬───┴────┬───────────┬──────────┐
    formation   digital    physical  service    creator   delivery
        │        product    product      │          │         │
        └──────────┴───────────┴────────┴──────────┴─────────┘
                    six vocabularies, in i18n and copyFor()
```

## The six types

| `store_type` | The trade | What an offering is called |
|---|---|---|
| `formation` | Training, courses, workshops | Formation |
| `digital_product` | Guides, templates, downloadable files | Produit |
| `physical_product` | Goods that ship or are collected | Article |
| `service` | Work performed for a client | Prestation |
| `creator` | Photography, music, design, media | Création |
| `delivery` | Courier and transport | Course |

The list lives in `packages/core/src/catalog/store-types.ts` as
`STORE_TYPES`, in a `CHECK` constraint on the column, and in the i18n
catalogues. All three must agree; `store-engine.test.ts` asserts the exact list
so adding a seventh is a deliberate act in four places rather than a typo in
one.

### There is no default

`parseStoreType` throws `UnsupportedStoreTypeError` for anything not on the
list, including `undefined`, `""`, `"FORMATION"` and `"service "`. It never
falls back.

That is a product decision, not a validation preference. The type decides how
somebody's shop presents itself to buyers; guessing it means guessing their
business. A seller who does not answer the question does not get a store.

## Ordering: the gates answer before the fields

`CreateStoreInput.storeType` is typed **raw**, not `StoreType`. This looks like
a weakening and is the opposite.

When it was typed `StoreType`, every HTTP boundary had to call `parseStoreType`
to satisfy the compiler — which put input validation **before** `authorize()`
and `requireSellerConsent()`. A stranger posting to `POST /api/v1/stores` was
answered *"unsupported store type"* (400) instead of *"denied"* (403): a fact
about the API's shape that they had not earned, handed out by the type system's
own insistence.

```
   request ──▶ authorize("store.create")   ──▶ 403 if denied
            ──▶ requireSellerConsent()     ──▶ 451 if terms not accepted
            ──▶ parseStoreType(raw)        ──▶ 400 only now
            ──▶ slug, brand, insert
```

`createStore` parses the value itself, after both gates. Callers hand it
through untouched. Two domain tests
(`refuses on permission before it looks at the type at all`, `refuses on consent
before it looks at the type`) and two browser assertions hold that order in
place.

## Lifecycle

```
        createStore
             │
             ▼
        ┌────────┐   publishStore    ┌───────────┐
        │ draft  │──────────────────▶│ published │
        └────────┘◀──────────────────└───────────┘
             ▲       unpublishStore        │
             │                             │ suspendStore
             │      reinstateStore         ▼
             └──────────────────────┌───────────┐
                                    │ suspended │
                                    └───────────┘
```

| Transition | Who | Note |
|---|---|---|
| → `draft` | the creator | `createStore`; owner is the session, never the input |
| `draft` → `published` | owner (`store.update`) | stamps `published_at` **once** |
| `published` → `draft` | owner (`store.update`) | `unpublishStore` |
| any → `suspended` | moderator (`store.moderate`) | reason of ≥4 characters, audited |
| `suspended` → `draft` | moderator (`store.moderate`) | **not** to published |
| `suspended` → `published` | nobody | the SQL excludes it |

Four of these deserve their reasons written down.

**A store may be published with zero offerings.** *(Review decision 1, phase 4.)*

An Afrinext store is a **commercial identity**, not a container that only
becomes real once it holds stock. A tailor who has claimed her name and her
public address can print it on a card and share it while she is still
photographing her work; a courier can be findable before he has listed his
first route. Requiring an offering first would hold a seller's storefront
hostage to inventory they have not finished preparing.

Nothing in the domain ever forbade this — `publishStore` has no offering check
and never had one. The requirement lived only in the seller dashboard, which
withheld the publish control until a product existed. That control is now tied
to the store's own `status`, not to which guidance message is on screen; tying
it to the message is how the rule became unwritten in the first place.

The obligation that comes with the permission is **honesty**:

| Surface | With zero published offerings |
|---|---|
| Public store page | "Aucune offre pour l'instant" / "Cette boutique prépare actuellement ses offres." |
| Marketplace card | "Aucune offre pour l'instant" — never a fabricated count |
| `listPublicProducts` | `[]` — never a placeholder row |
| `discoverOfferings` | contributes nothing |
| `countStoresByType` | counts the store once; it is a real store |

No invented product, no placeholder price, no "coming soon" item in the list,
no sales, ratings or followers. `store-engine.test.ts` asserts both halves —
that it publishes, and that it produces nothing — and the browser suite visits
the published empty storefront anonymously and asserts there is no `XOF` on the
page and no link to an offering under it.

The permission also loosened nothing else: an empty store is publishable, but
not by a stranger and not while suspended. Both are tested.

**`published_at` is stamped with `coalesce(published_at, now())`.** A store that
is unpublished and republished keeps its original date. Without that, "newest
stores" — the most valuable position on the marketplace home — could be claimed
indefinitely by toggling a switch.

**Reinstatement returns a store to `draft`, not to `published`.** Lifting a
suspension restores the owner's *ability* to be public; it does not publish on
their behalf. A seller whose store was suspended over a disputed listing should
decide when it goes back up, not discover that a moderator did it for them.

**A suspended store cannot be published**, and the guard is
`where id = … and status <> 'suspended'` inside the UPDATE rather than a read
followed by a check. A publish racing a suspension therefore cannot slip
through the gap between the two statements.

**A store's type is editable only while it is a draft**, and that guard is also
in the statement:

```sql
store_type = case when status = 'draft' then coalesce($1, store_type)
                  else store_type end
```

Buyers have seen a published store presented one way and its offerings were
written for that presentation. Turning a formation into a delivery service is
not an edit; it is a different business.

## Ownership

A store belongs to the authenticated session that created it. `owner_user_id`
comes from `actor.userId` and from nowhere else — there is no field in any
request through which a caller could open a store in somebody else's name, and
a test posts `ownerUserId`, `owner_user_id` and `userId` together to prove the
row still belongs to the sender.

Authorization is `authorize()` with a store scope, never "the owner column says
you, so you may":

| Action | Permission | Scope |
|---|---|---|
| create | `store.create` | global |
| update, publish, unpublish | `store.update` | that store |
| suspend, reinstate | `store.moderate` | global (`ops`, `superadmin`) |

`store.moderate` is deliberately a **platform** permission. Owning a store is
not it, and a seller cannot suspend a rival — or themselves, which is checked
because "suspend my own store" and "unpublish my own store" are different
operations with different audit meanings.

### Granting the `seller` role — an open operational requirement

There is **no admin console**. Becoming a seller means an operator running:

```sql
insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
select gen_random_uuid(), '<user-uuid>'::uuid, r.id, 'global', null
  from roles r where r.key = 'seller';
```

*(Review decision 3, phase 4: keep this for now; do not build a console in this
milestone.)*

This is recorded as a **pre-launch operational requirement**, not a permanent
design. It is workable at the scale of the first few sellers, who will be
onboarded by hand anyway, and it is safe — the grant goes through the same
`role_assignments` table `authorize()` reads, so nothing is bypassed. What it
lacks is an audit trail naming *who* granted it and *why*, and a way for anyone
but a database operator to do it.

The console is its own milestone. Until it exists, every seller on Afrinext was
enabled by a human with production database access, and that is a fact worth
stating plainly rather than leaving to be discovered.

## Visibility is decided in SQL

Every public query filters `status = 'published'` **in the statement**. A draft
store is not a row a caller receives and declines to render; it is a row the
caller never receives.

| Function | Filter |
|---|---|
| `findPublicStore` | `slug = $1 and status = 'published'` |
| `listPublicProducts` | `p.status = 'published' and s.status = 'published'` |
| `discoverStores` | `s.status = 'published'` |
| `discoverOfferings` | `p.status = 'published' and s.status = 'published'` |
| `countStoresByType` | `status = 'published'` |

Both conditions on the offering queries, always: a published product inside a
suspended store is not public, and the join enforces that rather than trusting a
caller to check the store separately.

### Not published and does not exist are the same answer

`findPublicStore` returns `undefined` for a draft store, a suspended store and a
slug that was never taken. The route turns all three into 404. Telling them
apart would let a stranger enumerate which slugs are in use and which sellers
have been suspended.

### The public projection is not a cast

`PublicStore` is built field by field from `StoreRecord`, which carries the
owner's user id and the internal store id. Naming the ten public fields is what
stops a column added next year — an internal note, a moderation flag, a risk
score — from reaching a stranger's browser because somebody ran a migration.

## Slugs

Derived from the name with `slugify`, then `assertUsableSlug`: lower-case,
3–48 characters, `^[a-z0-9]+(-[a-z0-9]+)*$`, enforced by a `CHECK` as well as by
the domain. Uniqueness is global across stores, checked before the insert and
guaranteed by a unique index.

A collision is refused with `SlugTakenError` rather than silently resolved by
appending a number. `atelier-couture-2` is not a name anybody chose, and a
seller who typed a name someone else already has should be told so while they
can still pick a different one.

*(Review decision 2, phase 4: keep this behaviour. Do **not** auto-append
`-2`, `-3`. The refusal reaches the seller as a validation error on the form
they are filling in, and the implementation stays deterministic — the same
name always produces the same slug and the same answer — and reversible: the
policy is one branch in `createStore`, not a scheme baked into stored data.)*

The slug is **not editable**. It is the store's public address; changing it
breaks every link a seller has already shared.

## Marketplace discovery

`packages/core/src/catalog/marketplace.ts`. Framework-free, like the rest of
`packages/core`, and returning plain data the web layer renders.

### Nothing is invented

There is no rating, no review count, no follower total, no "verified" badge, no
seeded `featured` flag, no view counter and no random ordering anywhere in this
file or in the interface that reads it. Afrinext has none of those facts on
launch day, and a buyer deciding whether to trust a seller in Niamey is exactly
the wrong person to show an invented number to.

The two facts that *are* real are shown: **when a store was published**, and
**how many published offerings it has** — including zero, said plainly.

### Sorting

| Sort | Ordering |
|---|---|
| `newest` (default) | `published_at desc nulls last` |
| `popular` | count of **paid** orders `desc`, then `published_at desc` |

`popular` counts `orders.status = 'paid'` and nothing else. A pending checkout,
an expired one and a failed one are not sales; counting them would measure
interest and call it demand.

The marketplace home does not show the popular row at all until it would differ
from the newest row. With no sales, "popular" is recency wearing a different
label, and presenting it that way is the fabrication this whole section exists
to avoid.

### Search

`ILIKE` over name, tagline and description — the honest tool for a marketplace
with tens of stores: nothing extra to run, nothing to keep warm, predictable in
French. The pattern is escaped, so a buyer searching for `100%` or `a_b` gets
those strings rather than wildcards.

When the catalogue outgrows it, the replacement is PostgreSQL full-text search
behind this same function. That is why callers pass a query **object** and never
a SQL fragment.

### Bounds

`limit` is clamped to 1–48 and `offset` to 0–5000, so no URL can ask for the
whole marketplace in one request. All discovery state — query, type, sort, page
— lives in URL search params, which makes a result linkable, makes the back
button step through searches, and lets the whole screen render on the server
with no client JavaScript. That is not a purity exercise: this is a marketplace
for phones on mobile data, and the fastest search result is one that arrives as
HTML.

## Products, and the extension points

`products` is currently digital-only (`kind = 'digital'`, enforced by a CHECK).
The store engine does **not** pretend otherwise: a physical-product store can be
created, published and found today, and selling a physical item needs the
product side extended.

The seams are already where they need to be:

| Extension | Where it lands | Not needed yet |
|---|---|---|
| Course structure | `products.kind = 'course'` + a `course_modules` table | modules, lessons, progress |
| Physical goods | `products.kind = 'physical'` + stock, weight, delivery zone | shipping quotes |
| Services | `products.kind = 'service'` + availability, call-out radius | booking calendar |
| Delivery | a job/route table keyed on the store | dispatch, tracking |

Each is a new `kind` plus a table that references `products`, behind the same
authorization, the same publication rules and the same discovery queries.
Nothing in this milestone has to be revisited to add one.

## The financial boundary

**This milestone moves no money and touches no ledger.** Explicitly not
implemented, and not started:

- settlement, payout, seller withdrawals
- wallet movements, commission payment, referral payout
- refund execution, payment capture logic
- any ledger posting

The only money this milestone reads is `orders.status = 'paid'`, counted for
ranking. It writes nothing to `orders`, `payments`, `ledger_entries`,
`account_balances` or `refunds`, and the payment state machine approved in
Phase 3 is untouched.

A published store with paid orders therefore has entitlement recorded in the
ledger exactly as before. What a seller is owed and when it reaches them is
settlement, which is a later milestone with its own review.

## Brands

Six palettes — `laterite`, `indigo`, `forest`, `ochre`, `aubergine`, `sable` —
named for materials rather than for hex values. A store with no chosen brand
gets one deterministically from its slug, so a store is never unstyled and the
same store always looks the same.

The colours reach components only as CSS custom properties under a
`[data-brand]` attribute. No component contains a hex value; `tokens.css` is the
only file that does.

## Files

| Path | What |
|---|---|
| `packages/db/migrations/0014_store_engine.sql` | columns, CHECKs, partial indexes |
| `packages/core/src/catalog/store-types.ts` | the six types, six brands, parsers |
| `packages/core/src/catalog/index.ts` | create, update, lifecycle, public reads |
| `packages/core/src/catalog/marketplace.ts` | discovery, search, ranking |
| `packages/core/src/catalog/store-engine.test.ts` | 30 tests over the above |
| `apps/web/src/app/[locale]/page.tsx` | marketplace home |
| `apps/web/src/app/[locale]/explorer/page.tsx` | search and browse |
| `apps/web/src/app/[locale]/s/[storeSlug]/page.tsx` | public store page |
| `apps/web/src/app/[locale]/sell/nouvelle/page.tsx` | the four-step wizard |
| `apps/web/src/lib/store-presentation.ts` | type → vocabulary, exhaustively |
