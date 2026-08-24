# The Afrinext preview environment on Render

> **This environment is a demonstration. It is not production, it takes no real
> money, and it must never be given any.**
>
> Mock payments, verification codes printed to a log, disposable data, no
> settlement, no payouts. Everything in it is fake except the code.

This document is the whole procedure: what to create, what to type, what is
secret, how to check it worked, and what the environment cannot do. The
machine-readable half lives in [`render.yaml`](../../render.yaml) at the
repository root; this file explains it and covers the steps a blueprint cannot
perform for you.

---

## 1. What is being built

One Render web service, one Render PostgreSQL 16 instance, one mounted disk.
No load balancer, no worker, no cron, no queue — Afrinext needs none of them
yet. The refund queue is driven through an admin route, not a scheduler.

```
  iPhone / desktop
        │  HTTPS (Render's certificate, Render's subdomain)
        ▼
  afrinext-preview          Node web service, `next start`
        ├── /var/data/content     mounted disk — uploaded product files
        └── DATABASE_URL          Render's private network
                 ▼
  afrinext-preview-db      PostgreSQL 16, its own instance, no public access
```

**Why a persistent Node service rather than a serverless one.** Uploaded
product files are bytes on a filesystem (`FilesystemContentStorage`, wired in
`apps/web/src/lib/content.ts`). On a platform where each request may reach a
different ephemeral instance, a file uploaded by one request is unreadable by
the next, and downloads fail unpredictably — a preview that lies about the
engine it is demonstrating. A long-lived process with a mounted disk is also
what keeps the `pg` connection pool meaningful.

**Why the preview database is isolated.** `render.yaml` declares the database
as its own resource and wires `DATABASE_URL` from it by reference. No URL is
written down anywhere, so there is no string to edit and no way to point this
service at another database by accident. A future production database will be a
different instance in a different blueprint.

---

## 2. Create the service

You need a Render account with billing enabled — a mounted disk requires a paid
instance type, and a free instance is reclaimed when idle, which would delete
every uploaded file.

1. **Push the branch** (already done): `claude/create-app-repository-1cxsih`.
2. In Render, choose **New → Blueprint** and connect this repository.
3. Select the branch `claude/create-app-repository-1cxsih`. Render reads
   `render.yaml` and shows you the two resources it will create.
4. Render will ask for the one value it cannot infer: **`APP_URL`**. You do not
   know it yet. Enter `http://localhost:3000` for now, or leave it and set it in
   step 6 — sign-in will not work correctly until it is right.
5. Apply. Render creates the database, the service and the disk, runs the build,
   then runs the pre-deploy command (migrations and seed) before sending traffic.
6. **Get the public URL.** When the service page finishes, the URL is at the top
   of it — `https://afrinext-preview.onrender.com`, or with a random suffix if
   that name is taken. It is also under *Settings → Custom Domains* as the
   `onrender.com` domain. Copy it exactly (`https://`, no trailing slash), put it
   in **Environment → `APP_URL`**, and save. Render redeploys automatically.

That URL is what you open on the iPhone. Render issues and renews the
certificate; there is no DNS to configure and no certificate to install.

### The database

The blueprint creates it — you do not create it by hand. Two settings are
worth knowing about:

- `postgresMajorVersion: "16"`, matching what CI runs the suite against.
- `ipAllowList: []` — no external connections at all. Reach it with
  `render psql` or from the service shell. If you want to connect from your
  laptop, add your own IP temporarily and remove it afterwards; the external
  connection string requires SSL (`?sslmode=require`), which `pg` honours
  without any change to the application.

### The disk

Also created by the blueprint: 1 GB mounted at `/var/data`, with
`CONTENT_STORAGE_DIR=/var/data/content`. A disk can be grown later but never
shrunk, and a service with a disk cannot run more than one instance — both are
fine here and neither is a production decision.

---

## 3. Environment variables

Everything below is already in `render.yaml` except where the table says
otherwise. **No secret value is committed to Git**, and none should ever be.

| Variable | Value | Secret? | Set by |
|---|---|---|---|
| `DATABASE_URL` | Render's internal connection string | **yes** | Blueprint, from the database resource |
| `SESSION_SECRET` | random, generated | **yes** | Blueprint (`generateValue`) |
| `MOCK_WEBHOOK_SECRET` | random, generated | **yes** | Blueprint (`generateValue`) |
| `APP_URL` | the service's public HTTPS URL | no | **You, by hand, after the first deploy** |
| `PAYMENT_PROVIDER` | `mock` | no | Blueprint |
| `ALLOW_MOCK_PAYMENTS` | `yes` | no | Blueprint |
| `ALLOW_CONSOLE_SENDER` | `yes` | no | Blueprint |
| `CONTENT_STORAGE_DIR` | `/var/data/content` | no | Blueprint |
| `ALLOW_PREVIEW_SELLERS` | `yes` | no | Blueprint — **preview only, see §6** |
| `LOG_LEVEL` | `info` | no | Blueprint |
| `DATABASE_POOL_MAX` | `5` | no | Blueprint |
| `NODE_VERSION` | `22` | no | Blueprint |

**`APP_URL` is the only variable you type.** Everything else is either a fixed
non-secret value or a secret Render generates and stores itself.

### Generating the secrets yourself

Render's `generateValue: true` produces a random base64 value and stores it
encrypted; you never see it and it never reaches Git. That is the recommended
path. If you would rather supply your own, replace the entry in the dashboard
with output from:

```bash
openssl rand -base64 48
```

Paste it straight into the Render dashboard. Do not put it in a file, a commit,
a chat message or a screenshot.

`SESSION_SECRET` does double duty: it signs sessions **and** derives the HMAC
key that signs download grants (`apps/web/src/lib/content.ts`). Changing it
signs everybody out and invalidates every outstanding download link. That is
correct behaviour, not a bug — just know it before rotating one casually.

### Variables that must NOT exist here

- **`IPAYMONEY_BASE_URL`, `IPAYMONEY_API_KEY`, `IPAYMONEY_WEBHOOK_SECRET`,
  `IPAYMONEY_ENVIRONMENT`** — none of them, ever, in any form, live or sandbox.
  iPayMoney is not implemented (`docs/providers/ipaymoney/README.md`), the
  adapter throws rather than pretending, and a preview is the last place a real
  payment credential should sit. **No iPayMoney credential belongs in this
  environment.**
- **`TEST_DATABASE_URL`** — nothing in the running server reads it. The vitest
  suite does, and it truncates every table it touches.
- **`ALLOW_DESTRUCTIVE_RESET`** — the guard on `pnpm db:reset`.
- **`NODE_ENV`** — every command sets the right value for itself. Overriding it
  has broken this build before; see the note in `.env.example`.

---

## 4. How migrations and seeding run

`render.yaml` sets:

```yaml
preDeployCommand: pnpm db:migrate && pnpm --filter @afrinext/core seed
```

Render runs this **after the build and before the new version receives
traffic**, so the schema and the reference data are in place the first time
anybody loads a page. Both commands are idempotent and run on every deploy:
`pnpm db:migrate` applies only what the `drizzle.__drizzle_migrations` table has
not seen, and the seed upserts.

**Seeding is not optional.** `authorize()` reads permissions and roles from
these tables, and currencies carry the minor-unit exponent that makes XOF
zero-decimal. An unseeded deployment refuses everything and prices nothing.

The build command is:

```yaml
buildCommand: corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build
```

`--prod=false` is load-bearing. Render sets `NODE_ENV=production` for Node
services and pnpm honours it by skipping devDependencies — which are not
optional here: `next build` needs TypeScript and Tailwind, and the migration
runner is `tsx`. Without the flag the build fails at install.

Two things to know if a first deploy misbehaves:

- **Pre-deploy commands require a paid instance type.** The blueprint already
  specifies one; on a free instance the migrations would silently never run and
  `/api/health` would report `migrationsApplied: 0`.
- **pnpm comes from `corepack`,** which reads the `packageManager` field in
  `package.json` and pins 10.33.0 — the version CI uses. If `corepack enable`
  ever fails on Render's image, replace it in the build command with
  `npm i -g pnpm@10.33.0`; do not let it fall back to an unpinned pnpm, because
  the lockfile is installed with `--frozen-lockfile` and a different pnpm can
  refuse it.

---

## 5. Verifying the deployment

Open `https://<your-url>/api/health`. A healthy environment answers `200`:

```json
{
  "status": "ok",
  "database": "reachable",
  "migrationsApplied": 16,
  "currenciesSeeded": 7,
  "permissionsSeeded": 30,
  "paymentProvider": "mock",
  "latencyMs": 12
}
```

The exact counts do not matter; **zero does**. `migrationsApplied: 0` means the
pre-deploy step did not run, and `currenciesSeeded: 0` or `permissionsSeeded: 0`
means the seed did not. A `503` with `"database": "unreachable"` means
`DATABASE_URL` is wrong or the database is still starting.

The endpoint deliberately reports no version numbers, hostnames or credentials.

Also confirm the preview is asking not to be indexed:

```bash
curl https://<your-url>/robots.txt      # → User-Agent: *  /  Disallow: /
```

---

## 6. Seller access

### On this preview: automatic

`render.yaml` sets **`ALLOW_PREVIEW_SELLERS=yes`**, so **every account created
on the preview is granted the `seller` role at signup**. Sign up, open
*Vendre*, create a shop. No SQL, no operator, as many test accounts as you like.

**This is a grant, not a bypass.** The flag adds one ordinary row to
`role_assignments` — the same row an operator would insert by hand — and then
gets out of the way. `authorize()` is not modified and never reads the flag, so
a preview seller reaches `store.create` through exactly the code path a
production seller does. Three consequences worth knowing:

- **It is revocable.** `update role_assignments set revoked_at = now() ...`
  takes the permission away while the flag is still set.
- **It is bounded.** The `seller` role holds exactly one permission,
  `store.create`. Not `store.moderate` (that is `ops` and `superadmin`), no
  `admin.*`, nothing touching the ledger, refunds or withdrawals. The
  `store_owner` role is still granted per store by `createStore` to whoever
  opened it, so one preview seller cannot administer another's shop.
- **It accepts nothing on your behalf.** Seller terms are still required before
  a store can be created; the app asks for them.

It is also audited under its own action, `auth.user.preview_seller_granted`, so
a preview grant is distinguishable from an operator's in the log, and it warns
at `WARN` level every time it fires — loud on purpose, so it is noticeable
anywhere it should not be.

> ### ⚠ Never set `ALLOW_PREVIEW_SELLERS` in production
>
> In production it would hand the ability to open a shop to anybody who can
> receive an SMS code. It exists for this preview and for local testing. It is
> off unless the value is the exact string `yes` — `true`, `1`, `YES` and
> `false` all leave the ordinary seller control fully in force, deliberately, so
> that somebody who sets it to `false` to disable it actually disables it.
>
> `packages/core/src/auth/preview-sellers.ts` explains the design; the
> adversarial tests are in `preview-sellers.test.ts`.

### Granting a role by hand

Still needed for two cases: an account that existed **before** the flag was
enabled (the grant happens at signup and is not retroactive), and any role other
than `seller` — `ops` for store moderation, `finance` for refund execution.

There is no admin console; Phase 4 review decision 3 kept the SQL grant and
recorded a console as its own milestone.

**First, find the right id.** This is where the mistake gets made:
`role_assignments.user_id` references **`users.id`** — the Afrinext identity —
and *not* `user.id`, which is Better Auth's credential row. They are different
tables with different id types, and `auth_user_id` is the link between them.
Insert the wrong one and you get zero rows and no error.

```sql
-- 1. Your credential row, by the phone number you signed up with (E.164).
select id, "phoneNumber", "createdAt" from "user"
 where "phoneNumber" = '+227XXXXXXXX';

-- 2. The Afrinext identity keyed to it. This id is the one roles use.
select id, auth_user_id, status, display_name from users
 where auth_user_id = '<the id from step 1>';
```

**Then grant, in one statement that finds the id itself** — no copy-paste
between windows, so there is nothing to get wrong:

```sql
insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
select gen_random_uuid(), u.id, r.id, 'global', null
  from users u
  join "user" au on au.id = u.auth_user_id
  cross join roles r
 where au."phoneNumber" = '+227XXXXXXXX'
   and r.key = 'seller';
```

`INSERT 0 1` is success. **`INSERT 0 0` means nothing was granted** — the phone
number does not match what you signed up with (it is stored in E.164, `+227…`),
or the role key is misspelled. Verify:

```sql
select r.key, ra.scope_type, ra.granted_at, ra.revoked_at
  from role_assignments ra
  join roles r on r.id = ra.role_id
  join users u on u.id = ra.user_id
  join "user" au on au.id = u.auth_user_id
 where au."phoneNumber" = '+227XXXXXXXX';
```

Run it through `render psql` or the service shell — never by opening the
database to the internet. Grant the fewest roles you need, to one account, and
remember that on this preview anyone who can read the log can sign in as any
account, including that one.

## 7. Testing the application

### Authentication

Sign-in is phone plus a one-time code, and **no SMS provider is chosen for
Niger yet**. The code is stored only as an HMAC hash (`otp_challenges`), so
there is nowhere to look it up; `ConsoleSender` prints it to the service log
instead, which is why `ALLOW_CONSOLE_SENDER=yes` has to be stated explicitly.

1. Open `/fr/sign-in` and enter a phone number in E.164 (`+22790000000`).
2. Open **Logs** on the Render service page — this works in mobile Safari, so
   you can do it from the same phone.
3. Find the line `ConsoleSender` printed and type the code into the app.
4. Accept the consent documents when asked. A new account is granted `member`
   and nothing else.

Rate limits are real and come from `platform_settings`, not from constants: too
many code requests answer `429` with `Retry-After`. Every verification failure —
wrong code, expired code, no challenge, attempts exhausted — answers the same
`400` with `auth.otp_invalid`, deliberately, so the endpoint cannot be used to
find out which accounts exist.

### Marketplace, stores and products

- `/fr` and `/fr/explorer` — the marketplace, search and categories. Empty on a
  fresh preview, and honestly empty: nothing fabricates a product, a rating or a
  follower count.
- `/fr/sell` — every preview account already holds the `seller` role (§6), so
  create a store, then publish it. A store
  may be published with zero offerings (Phase 4 review decision 1) and shows
  *« Aucune offre pour l'instant »* until it has one.
- Add a digital product, upload a file, set the licence text and the per-file
  download limit, then publish. Publishing refuses a product with no file: a
  buyer would receive nothing.
- `/fr/s/<store>/<product>` — the public page, with the licence shown *before*
  purchase.
- `/fr/library` — what a signed-in buyer actually owns. It lists only real
  purchases; there is no client-side flag that can put anything in it.

### Mock payment confirmation — read this before trying to buy

**A purchase cannot currently be completed from the phone alone, and that is
deliberate.** The mock provider is asynchronous, exactly like a real one:
`POST /api/v1/orders/:id/pay` leaves the order `pending`, and the order only
becomes `paid` when a **signed webhook** arrives at
`/api/v1/payments/webhook`. That boundary — HMAC over the raw bytes, a replay
index, an idempotent apply — is one of the most security-relevant parts of the
payment domain, and making the mock confirm synchronously to make a demo
smoother would hide the very thing worth demonstrating. It has not been changed
and should not be.

So confirming a preview payment means sending that webhook yourself, from a
machine with a shell:

1. Start the payment in the app and note the order.
2. Read the payment's `providerRef` (`/fr/orders/<id>` shows the attempt).
3. POST a success event signed with `MOCK_WEBHOOK_SECRET`.

`apps/web/e2e/checkout.spec.ts` is the worked example — it builds exactly this
request, including the signature — and `packages/core/src/payments/mock.ts`
defines the event shape and how it is signed.

If you want to confirm payments from the phone with no laptop, that is a
product decision, not a deployment one, and there are two honest options: a
preview-only operator control gated behind `ALLOW_MOCK_PAYMENTS`, or a small
signed-webhook helper you run once per purchase. Neither has been built. Ask
for one explicitly if you want it.

---

## 8. What this preview does not protect

The preview keeps **every** application security rule switched on: the same
`authorize()`, the same rate limits, the same OTP hashing, the same entitlement
checks, the same append-only ledger. `ALLOW_MOCK_PAYMENTS` and
`ALLOW_CONSOLE_SENDER` do not weaken a check at all — they are the codebase's
own way of making a deployment state out loud that it is not handling real
money, and without them the application refuses to start those components.
`ALLOW_PREVIEW_SELLERS` is different in kind and worth being precise about: it
weakens no check either, but it hands out a role that production would make
somebody earn. The gate still runs; more people pass it.

What is genuinely weaker is the environment around it:

1. **The URL is public.** `noindex` and `robots.txt` ask crawlers to stay away;
   they are not access control. Anyone with the link can open it.
2. **Verification codes are in the log.** Anyone with Render dashboard access
   can sign in as any preview account. Treat that access as the real credential.
3. **Payments can be forged by anyone holding `MOCK_WEBHOOK_SECRET`.** They are
   fake payments, but that also means *the preview is not evidence about
   production payment security*.
4. **Anyone who signs up becomes a seller** (`ALLOW_PREVIEW_SELLERS`). That is
   the point here and would be a serious defect anywhere else. It grants
   `store.create` and nothing more, but it does mean the preview does not
   demonstrate how sellers are onboarded in production.
5. **`SESSION_SECRET` also signs download grants**, so a leak is both session
   forgery and download-token forgery.
6. **There are no backups.** One disk, one database, no snapshots configured.
   Everything in the preview is disposable and should be treated that way.
7. **Uploaded files are real bytes on a real disk.** Upload only throwaway
   content.

### Optional: a password gate

Afrinext has no shared-password or IP-allowlist gate in front of the
application, and one is **not** added here. Adding it would mean either a piece
of Render infrastructure in front of the service or a new authentication path in
the application — and a second way in is the last thing an application with a
carefully built authentication boundary needs, invented for a preview.

If you want the preview restricted rather than merely unlisted, the choices in
increasing order of intrusiveness are: keep the URL private and unlisted (what
this configuration assumes); put a proxy that requires a password in front of
the Render service; or add a preview-only gate in the application. The third is
a code change and needs its own review. **This is deliberately documented as an
option, not implemented.**

---

## 9. The line that must not be crossed

This environment must never be used with real customer money, real customer
data, or a real payment credential. Nor may `ALLOW_PREVIEW_SELLERS` follow it
anywhere: it is the one variable here with no production counterpart at all. It has no settlement, no payouts, no
iPayMoney integration, and a payment provider that confirms charges nobody
made. Turning it into production is not a matter of changing variables: it
needs a real payment provider, a real SMS provider, object storage, backups and
a security review — each of which is its own milestone.

If somebody asks whether they can "just use the preview" for a real sale, the
answer is no.
