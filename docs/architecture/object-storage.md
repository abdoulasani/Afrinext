# Object storage for digital assets

## The problem this milestone solves

`FilesystemContentStorage` writes bytes to a directory. That is correct for
development, for CI and for one server, and wrong the moment Afrinext runs two
web instances: a file uploaded by instance A is not on instance B's disk, so a
buyer's download fails depending on which machine answered — intermittently,
which is worse than failing outright.

Nothing else about the engine changes. This milestone adds **one adapter behind
an existing port**.

## What did NOT change

The authorization chain is untouched, and the port is what guarantees that:

```
session cookie            requireActor()
  → short-lived grant     HMAC, subject-bound, decoded before anything is read
  → live entitlement      SQL, scoped to the actor, revoked_at is null
  → purchased version     a.version_id = e.version_id
  → published product     p.status = 'published' AND s.status = 'published'
  → download limit        count(entitlement_downloads) < products.download_limit
  → ContentStorage.open() ← the ONLY place storage is touched
```

Storage is the last step and it is handed a key it did not choose. It performs
no authorization, knows nothing about buyers, entitlements, versions or limits,
and cannot be reached without every check above having passed first.

The diff for `packages/core/src/content/access.ts` in this milestone is empty.

## The strategy: S3-compatible, not "S3"

One adapter, `S3ContentStorage`, speaking the S3 HTTP API. That single choice
serves AWS S3, **Cloudflare R2**, Backblaze B2, Scaleway (Paris — the closest
region to Niger among the major providers), DigitalOcean Spaces and MinIO,
because they all implement the same API. The deployment picks a provider by
setting an endpoint, not by shipping different code.

The alternative — a provider-specific SDK — would tie Afrinext to one vendor's
pricing and one vendor's egress policy at exactly the moment those matter most.

### Why the request is signed by hand

`@aws-sdk/client-s3` is several megabytes of dependency, and `packages/core`
has five runtime dependencies precisely because it is meant to stay portable.
The adapter needs three verbs — PUT, GET, DELETE on one object — and AWS
Signature Version 4 is a published, closed specification: a canonical request,
a string to sign, a derived key, an HMAC. It is about sixty lines of
`node:crypto`, which is the same posture the codebase already takes with its
own HMAC content grants and its hand-written SQL.

That decision carries a real risk — a subtly wrong signature fails only against
a real server — and it is answered in two ways. The signer is asserted against
**AWS's own published SigV4 test vector**, so the canonicalisation and key
derivation are checked against a known-good answer rather than against my own
reading of the spec. And every adapter test runs against a test server that
**independently recomputes the signature** and rejects a mismatch, so each of
those tests is also a signing test.

## `open()` returns bytes, never a URL

Requirement, and the reason the port was shaped this way in Phase 5:

> **Reads return bytes, not locations.** An object store's pre-signed URL is a
> perfectly good adapter for `open()` — built *inside* an implementation of this
> port, where the entitlement check has already happened, and with a lifetime
> measured in seconds.

The adapter authenticates **server to server** with a SigV4 `Authorization`
header and streams the response into a Buffer. It never mints a pre-signed URL,
so there is no URL that could leak, be logged, be shared, or outlive the request
that created it. The browser continues to receive bytes from Afrinext's own
origin, through the one route that requires a session and a grant.

A pre-signed URL would be a legitimate optimisation for very large files later —
it would still be created only after the chain above has passed, with a lifetime
in seconds, and it would still never appear in a rendered page. It is not needed
for a 25 MB ceiling and is not built.

**The bucket is private.** Nothing in this design works, or is meant to work,
with public object ACLs.

## Storage keys stay opaque

Keys are `products/{productId}/{versionId}/{assetId}` — generated from UUIDs,
never from user input, validated by `assertUsableStorageKey` before every read
and write. A key is not a URL and cannot be turned into one by a client.

`storage_key` is selected only by `resolveEntitledAsset`, which is called after
the entitlement is proved, and it is used to call `open()` and for nothing else.
It is not in any public product or library type, not in any API response, and a
browser test asserts it never appears in a page's source.

## Which adapter runs, and how a misconfiguration behaves

`CONTENT_STORAGE` selects: `filesystem` (default) or `s3`.

The important half is what happens when it is set wrong. A production
deployment that names `s3` but supplies no bucket must **fail at startup**, not
serve a broken storefront: silently falling back to the local disk is how a
multi-instance deployment appears to work for a week and then loses a seller's
files. So the factory throws when `s3` is selected without complete
configuration, and — separately — refuses `filesystem` under `NODE_ENV=production`
unless `ALLOW_LOCAL_CONTENT_STORAGE=yes` says the single-server tradeoff was
deliberate. That is the same shape as `ALLOW_MOCK_PAYMENTS`: the dangerous
default requires a second, explicit sentence. An adapter name that is neither —
`CONTENT_STORAGE="S3"`, say — throws as well, because resolving a typo to the
default is the same silent fallback with better manners.

That decision lives in `packages/core/src/content/select.ts`, as
`selectContentStorage(env)`, and takes the environment as an argument rather
than reading `process.env`. It was written inside the Next.js app first, and
the mutation matrix said no: a fail-closed rule that only exists in `apps/web`
is a rule no unit test can reach, so a mutation deleting it survived. Moving it
to a pure function of its environment turned each misconfiguration into a
two-line test, and `apps/web/src/lib/content.ts` back into what it should be —
one call and a cache.

## What a failed write is allowed to say

The server action that attaches a file renders `error.message` directly on the
seller's screen. A provider's error body names the bucket, the object key and an
account id — so an upload failure is one of the few paths on which Afrinext's
infrastructure could walk out through the UI, triggerable by any seller who
uploads while the bucket is unhappy.

`put()` and `remove()` therefore log the provider's status and body under
`component: content.s3` and throw `StorageWriteFailedError`, whose message
carries no key, no bucket, no endpoint and nothing the provider said. A test
asserts all four are absent from what the seller would read. Reads are
different: the download route collapses every refusal into one generic 403, so
`ContentUnavailableError` never reaches a browser at all.

## Environment variables

| Variable | Meaning |
|---|---|
| `CONTENT_STORAGE` | `filesystem` (default) or `s3` |
| `CONTENT_S3_ENDPOINT` | the provider's API endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` |
| `CONTENT_S3_REGION` | region, e.g. `auto` for R2, `eu-west-3` for AWS Paris |
| `CONTENT_S3_BUCKET` | the bucket name. **Must be private.** |
| `CONTENT_S3_ACCESS_KEY_ID` | **secret** |
| `CONTENT_S3_SECRET_ACCESS_KEY` | **secret** |
| `CONTENT_S3_FORCE_PATH_STYLE` | `yes` for MinIO and most S3-compatible providers; omit for AWS |
| `ALLOW_LOCAL_CONTENT_STORAGE` | `yes` to run filesystem storage under a production build anyway |

`CONTENT_STORAGE_DIR` keeps its meaning for the filesystem adapter.

## No credentials exist yet, and none are pretended

There is no object-storage account for Afrinext, so **`CONTENT_STORAGE` is not
set to `s3` anywhere**, including the Render preview, which continues to run
filesystem storage on its mounted disk with `ALLOW_LOCAL_CONTENT_STORAGE=yes`.

This is the same posture as iPayMoney: the boundary is built and tested, the
adapter is real code that speaks a real protocol, and nothing claims a
production bucket is configured. Choosing a provider and issuing credentials is
an operational decision with a bill attached, and it is not made here.

## How the adapter is tested without a bucket

No S3 server can run in this environment — there is no Docker daemon and the
MinIO binary is not reachable. So the suite runs against
`S3TestServer`: a real HTTP server implementing the object verbs, which
**verifies the SigV4 signature of every request** and answers `403` when it does
not match.

It is a test double and is named one. What it establishes is precise: that the
adapter forms correct canonical requests, derives the signing key correctly,
round-trips bytes and content types over HTTP, and behaves correctly on 404 and
on transport failure. What it does not establish is that a particular vendor
accepts those requests — only a real bucket does that, and that is the first
item under remaining work.

## Multi-instance proof

The point of the milestone is a claim about two machines, so the browser suite
proves it with two machines: two `next start` instances on different ports,
sharing one storage backend and one database. A seller uploads through instance
A's real screens; a buyer downloads through instance B's real screens and
receives the identical bytes. Run against the filesystem adapter with a shared
directory it proves the wiring; run against the S3 adapter it proves the
milestone.
