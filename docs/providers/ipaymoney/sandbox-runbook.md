# Running the sandbox suite

**Status: NOT RUN. No credentials have ever been present in this environment,
and no request has ever been made to iPayMoney from this repository.**

## Which key goes where

The documentation is explicit, and the two keys are not interchangeable.

| Key | Role | Where it goes | Evidence |
|---|---|---|---|
| **Secret** (*clé secrète* / *clé privée*) | Server-to-server authentication | `Authorization: Bearer <secret>` on both endpoints | L167, L237 |
| **Secret**, again | Webhook authenticity | The dashboard's **Secret Hash** field — *« C'est votre clé API secrète »* | L316 |
| **Public** (*clé publique*) | Client-side only: the JavaScript and Android SDKs, the WordPress plugin, the `data-key` attribute of the checkout widget | **Nowhere in Afrinext** | L139, L388, L401 |

> *« La clé publique … est destinée au public. Elle peut être intégrée dans vos
> code Javascript et Android. »* — L139
> *« Seuls un propriétaire de compte et iPayMoney connaissent la clé secrète …
> Elle est utilisée par le serveur pour valider les transactions. »* — L140

**Afrinext's integration is entirely server-to-server**, so the public key has
no role in it at all. It is not a variable, not a config field, and not
something to find a use for. Anything that appears to need it would be a
client-side checkout widget, which Afrinext does not use.

`IPAYMONEY_API_KEY` therefore means **the secret key**.
`IPAYMONEY_WEBHOOK_SECRET` defaults to the same value, which is what L316
describes; set it separately only if iPayMoney later answers **K7** by saying
the two differ.

## The base URL

There is **no separate sandbox host.** Both endpoints are documented at
`https://i-pay.money` (L161, L228), and the environment is selected by a
**header**:

> `Ipay-Target-Environment` | string | *« sandbox … ou live »* — L168

So `IPAYMONEY_BASE_URL=https://i-pay.money` for sandbox and for live alike, and
what keeps the two apart is `IPAYMONEY_ENVIRONMENT`. That variable has **no
default anywhere in the code**: not defaulting it is how a missing value becomes
a refusal rather than a live charge.

## Running it

Credentials go in the environment, never in a file this repository tracks.

```bash
export IPAYMONEY_BASE_URL=https://i-pay.money
export IPAYMONEY_API_KEY=…            # the SECRET key
export IPAYMONEY_ENVIRONMENT=sandbox  # exact word, or nothing runs

pnpm --filter @afrinext/core exec vitest run src/payments/ipaymoney.integration.test.ts
```

The 16 gated tests run only when all three are present **and** the environment
is exactly `sandbox`. `ipaymoney.integration.test.ts` contains an
always-running suite that proves this: `live`, `LIVE`, `Sandbox`, `SANDBOX`,
` sandbox`, `sandbox `, `sandbox2`, `production`, `prod`, `sand`, `""` and an
absent value all leave the suite skipped.

**Never** put a key in `.env`, a test, a fixture, a commit message, a log, a
screenshot or a review PDF. The `.env` file this repository reads is
gitignored, but the safer habit is `export` in the shell that runs the suite so
the value never reaches a file at all.

## What each test would answer

| Test | Question |
|---|---|
| creates a payment and receives a reference | **A13** — that mobile money is accepted for Niger and XOF at all |
| status query round-trip | `getCharge` against a real reference |
| CONFIRMS OR REFUTES that no amount is returned | **K8** — if an amount comes back, `statesChargeAmount` is wrong in our favour and changes on evidence |
| reused `transaction_id` answers 422 | **K10** — that a reuse is a rejection, not an idempotent replay |
| eight scenario numbers | **K12** — the real `status` string for declined and insufficient funds. The adapter refuses an undocumented status, so it fails loudly with the exact value |
| the 180-second pending scenario | Genuine in-flight state, at a 240s timeout |
| unreachable host | The transport classifier against a real DNS failure |
| refund is not exercisable | **K1**, **K5** — there is nothing to call |

**K13** (whether `"5000"` means 5 000 francs) is answered by reading the
dashboard after a successful sandbox charge, not by an assertion: the API
echoes no amount back, which is K8.

## What the sandbox cannot answer here

A real **inbound webhook** needs a publicly reachable URL for iPayMoney to call.
This environment has none, so **K7** — which header name actually arrives, and
whether its value is the secret or a signature over the body — stays open even
with credentials in hand. Answering it needs either a tunnel to a running
instance or a deployed environment with a public URL.
