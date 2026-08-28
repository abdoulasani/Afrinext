# Cloudflare R2 — the production object store

**Status: specified and configured in code. NOT yet connected to a real
bucket.** No Cloudflare account exists for AFRI NEXT TECHNOLOGIE, so no
endpoint, no bucket and no API token exist either. Everything below is what an
operator does once, and what the application already expects.

The adapter itself is finished and tested — `S3ContentStorage` in
`packages/core/src/content/s3.ts`, proved against AWS's published SigV4 test
vector and against a signature-verifying server. R2 needs **no new code**: it
is the same S3 HTTP API, reached at a different endpoint.

---

## 1. The architecture, exactly

```
  buyer's browser
        │  GET /api/v1/content/<grant token>      (Afrinext origin, session cookie)
        ▼
  Afrinext web instance  ── openContent() ──►  session
                                               live entitlement
                                               version purchased
                                               product + store published
                                               download limit
                                               grant signature + expiry
                                                     │  all passed
                                                     ▼
                             S3ContentStorage.open(key)
                                                     │  SigV4, server-to-server
                                                     ▼
                     https://<ACCOUNT_ID>.r2.cloudflarestorage.com
                                 bucket: afrinext-content-prod   (PRIVATE)
                                                     │
                                                     ▼
                                        bytes ──► Buffer ──► response body
```

**The browser never talks to R2.** Not once, in either direction. Uploads go
`browser → Afrinext → R2`; downloads go `R2 → Afrinext → browser`. There is no
pre-signed URL, no redirect to a bucket host, and no bucket hostname in any
page. This is the property every item below exists to keep true.

R2 was proposed for one concrete reason: **egress is free**. A catalogue whose
whole product is files downloaded repeatedly pays its bill in egress, and on R2
that line is zero. The adapter stays S3-compatible regardless, so the decision
is reversible by changing four variables.

### What R2 needs that AWS does not

| | Value | Why |
|---|---|---|
| `CONTENT_S3_REGION` | `auto` | R2 has no AWS-style regions. The signature carries `auto` and R2 accepts it. |
| `CONTENT_S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | Account-scoped, no bucket in the host. EU-jurisdiction buckets use `<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. |
| `CONTENT_S3_FORCE_PATH_STYLE` | `yes` | Puts the bucket in the path rather than the hostname. R2 supports both; path style is the one that works on every S3-compatible provider, so it is what we use. |

The three verbs the adapter uses — `PutObject`, `GetObject`, `DeleteObject` —
are all supported by R2's S3 API.

---

## 2. Every environment variable

| Variable | Example | Secret? |
|---|---|---|
| `CONTENT_STORAGE` | `s3` | no |
| `CONTENT_S3_ENDPOINT` | `https://abc123….r2.cloudflarestorage.com` | **not a credential, but do not publish it** — see §3 |
| `CONTENT_S3_REGION` | `auto` | no |
| `CONTENT_S3_BUCKET` | `afrinext-content-prod` | no, but not published |
| `CONTENT_S3_ACCESS_KEY_ID` | R2 token's Access Key ID | **YES — server-only secret** |
| `CONTENT_S3_SECRET_ACCESS_KEY` | R2 token's Secret Access Key | **YES — server-only secret** |
| `CONTENT_S3_FORCE_PATH_STYLE` | `yes` | no |

Not used in production: `CONTENT_STORAGE_DIR` and `ALLOW_LOCAL_CONTENT_STORAGE`
belong to the filesystem adapter, which production refuses to run.

---

## 3. Which of these are server-only secrets

**Two are credentials: `CONTENT_S3_ACCESS_KEY_ID` and
`CONTENT_S3_SECRET_ACCESS_KEY`.** Together they authorise reading and writing
every object in the bucket. They are read by `packages/core` inside a Node
process and are never sent anywhere except in the `Authorization` header of a
request to R2.

Three structural facts keep them server-only, and none of them is a convention
somebody has to remember:

- **No `NEXT_PUBLIC_` prefix.** Next.js only inlines a variable into client
  JavaScript if its name begins with `NEXT_PUBLIC_`. None of these do, so the
  bundler cannot put them in a browser bundle even by mistake.
- **`packages/core` is never imported by a client component.** The adapter is
  constructed in a route handler and a server action.
- **They are never logged.** `put()` and `remove()` log the provider's status
  and body on failure; the config is not in that record, and a test asserts the
  bucket, key, endpoint host and status are absent from what a seller is shown.

The **endpoint and bucket name are not credentials** — they are useless without
a token — but they are still kept out of pages and out of Git, because naming
your storage account is free reconnaissance. A browser test asserts neither
appears in the library or product HTML.

---

## 4. Bucket naming and environment separation

**One bucket per environment. Never shared.**

| Environment | Bucket | Data |
|---|---|---|
| production | `afrinext-content-prod` | real sellers' files |
| preview (Render) | `afrinext-content-preview` | throwaway |
| local development | *no bucket* — filesystem adapter | throwaway |
| CI and browser tests | *no bucket* — the in-repo fixture | throwaway |

Each environment gets **its own API token, scoped to its own bucket**. R2 tokens
can be scoped to a set of buckets, so the preview token must not be able to read
production. That is the point of separating them: a leaked preview credential
must not reach a real seller's file.

Never point two environments at one bucket. The database is what makes a
`storage_key` meaningful, and two environments have different databases — so a
shared bucket accumulates objects nothing references, and a restored database
snapshot starts referring to keys that belong to another environment's rows.

CI does **not** get a bucket. The browser suite runs its own signature-verifying
fixture, so a CI run neither needs a credential nor can be made to leak one.

---

## 5. CORS: nothing to open, and nothing to configure

**An R2 bucket has no CORS policy by default, and Afrinext's must stay that
way.**

CORS only governs requests a *browser* makes cross-origin. In this design a
browser never makes a request to R2 at all — every byte is fetched server-side
and re-served from Afrinext's own origin. So there is no CORS policy to write,
and a bucket with no CORS policy is exactly correct.

Adding `AllowedOrigins: ["*"]` — the reflex fix when a browser upload fails —
would be meaningless here at best. It is also the shape of change that arrives
alongside a switch to browser-direct uploads, which would mean pre-signed URLs,
which this architecture deliberately does not use. **If anyone ever needs to set
a CORS policy on this bucket, something has gone wrong upstream of the bucket.**

---

## 6. Public access must be disabled, and is by default

**R2 buckets are private by default and require an explicit action to become
public.** No action is the correct action. Concretely, after creating the
bucket, confirm under **R2 → the bucket → Settings → Public access**:

- **`r2.dev` subdomain: Disabled.** This is the one-click "make it public"
  switch. Cloudflare rate-limits it and documents it as development-only. It
  must read *Disabled*.
- **Custom domains: none.** Connecting a domain to the bucket publishes it just
  as effectively, without the word "public" appearing anywhere.

Both are also things to re-check after anyone else touches the account, which is
why §7 is a test rather than a screenshot.

---

## 7. Proving an unauthenticated browser cannot read the bucket

Confirmation by dashboard screenshot is a promise. This is the check:

```bash
pnpm --filter @afrinext/core verify:storage
```

`packages/core/scripts/verify-object-storage.ts` runs against whatever
`CONTENT_S3_*` is in the environment and, among other things, **fetches the
object's URL with no `Authorization` header at all** — which is precisely what a
browser that guessed the URL would send. R2 must answer `401`/`403`. If it
answers `200`, the bucket is public, and the script fails loudly and says so.

It also fetches the bucket root unauthenticated, so a bucket that lists its
contents is caught as well.

The script prints no credentials — not the key, not the secret, not the
`Authorization` header — and it deletes the probe object it wrote.

---

## 8. Secrets reach Render through Render, never through Git

`render.yaml` declares the five `CONTENT_S3_*` variables with **`sync: false`**.
That is Render's marker for "this value is set in the dashboard, not in this
file". The repository therefore contains the *names* and nothing else, which is
the same posture `DATABASE_URL` and `SESSION_SECRET` already have.

An operator sets the two credentials once, in **Render → the service →
Environment**, and rotates them there. A value pasted into `render.yaml` would
be committed, pushed, and readable by everyone with repository access forever —
git history keeps it after the line is deleted.

**Consequence, stated plainly:** a deploy that has not had these set will
**fail to start**. That is the intended behaviour, not a regression — see below.

---

## Failing closed

A production build gets object storage or it gets nothing:

| Configuration | Result |
|---|---|
| `CONTENT_STORAGE=s3`, all five values present, HTTPS endpoint | runs |
| any of the five missing or empty | **throws at startup** |
| endpoint is `http://` on a non-loopback host | **throws at startup** — credentials would cross the network in the clear |
| `CONTENT_STORAGE=filesystem` under `NODE_ENV=production` | **throws at startup** |
| `CONTENT_STORAGE` unset under `NODE_ENV=production` | **throws at startup** |
| a name that is neither, e.g. `S3`, `r2` | **throws at startup** |

There is no fallback path from a broken `s3` configuration to the local disk.
That was the whole point of the previous milestone: a silent fallback produces a
storefront that looks healthy and loses a seller's file days later, on one
instance out of two.

The filesystem adapter remains, unchanged, for **development and CI** — and for
a deployment that is deliberately a single server, which must say so with
`ALLOW_LOCAL_CONTENT_STORAGE=yes`. Nothing in production sets that.

---

## The operator's checklist, in order

1. Create a Cloudflare account for AFRI NEXT TECHNOLOGIE and enable R2.
2. Create bucket **`afrinext-content-prod`**. Choose a jurisdiction
   deliberately if data location matters; the endpoint changes if you do.
3. Confirm **Public access → r2.dev subdomain: Disabled**, and no custom domain.
4. Leave CORS unset.
5. Create an **R2 API token**, permission **Object Read & Write**, **scoped to
   that bucket only**. Copy the **Access Key ID** and **Secret Access Key** —
   Cloudflare shows the secret once.
6. Repeat 2–5 for **`afrinext-content-preview`** with its own token.
7. In **Render → Environment**, set `CONTENT_S3_ENDPOINT`, `CONTENT_S3_BUCKET`,
   `CONTENT_S3_ACCESS_KEY_ID`, `CONTENT_S3_SECRET_ACCESS_KEY`. `CONTENT_STORAGE`,
   `CONTENT_S3_REGION` and `CONTENT_S3_FORCE_PATH_STYLE` come from `render.yaml`.
8. Run `pnpm --filter @afrinext/core verify:storage` against the bucket, and
   read its output. It must end `ALL CHECKS PASSED`.
9. Deploy, then run the real end-to-end journey.

**Rotation:** create a second token, set it in Render, redeploy, then delete the
old token in Cloudflare. Objects are unaffected — a token authorises access, it
does not own the data.

---

## Sources

- S3 API compatibility, endpoint and `auto` region — <https://developers.cloudflare.com/r2/api/s3/api/>
- Authentication and bucket-scoped tokens — <https://developers.cloudflare.com/r2/api/tokens/>
- Public buckets and the `r2.dev` subdomain — <https://developers.cloudflare.com/r2/buckets/public-buckets/>
- Data location and jurisdiction endpoints — <https://developers.cloudflare.com/r2/reference/data-location/>
