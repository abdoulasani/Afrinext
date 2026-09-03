# Refund execution policy

**Status:** decided and implemented. Phase 3.
**Decided by:** the senior review, approving the Phase 3 design with one
required correction (see *The correction* below).
**Applies to:** every payment provider, present and future. Nothing here is
provider-specific, and nothing here assumes anything about iPayMoney.

## The situation

Phase 2 established that a verified successful payment is never ignored, and
that a payment which arrives too late to fulfil leaves the order at
`refund_due` — a queue meaning *payment confirmed, Afrinext did not deliver,
a refund is owed*. Nothing executed one.

Executing one means talking to a payment provider over a network. Networks
fail in ways that look identical from our side and are not identical at all.

## The rule everything follows from

> **UNKNOWN MUST NEVER BECOME FAILED.**

A refund request that timed out, lost its connection, or came back with an
HTTP 5xx **after the bytes left this process** is not evidence that no money
moved. Reading it as failure makes the refund retryable, and retrying a refund
that already happened pays the buyer twice.

So the question the system asks is never *what did the response say?* but
**how far did the request get?**

| Stage | Meaning | Classified as |
|---|---|---|
| `not_transmitted` | We can **prove** the request never reached the provider | `failed` — retryable |
| `transmitted` | The bytes left. What the provider did with them is a separate question | `in_doubt` unless the answer itself carries evidence |
| `unknown` | We cannot establish whether they left | `in_doubt` |

### What counts as proof of non-transmission

A short, closed list, in `packages/core/src/payments/refund-outcome.ts`:
DNS failure (`ENOTFOUND`, `EAI_AGAIN`), connection refused or unreachable
(`ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `EADDRNOTAVAIL`), TLS failure
at handshake, and a request we never built (`ERR_INVALID_URL`).

Deliberately **absent**, each for a reason:

| Code | Why it is not proof |
|---|---|
| `ECONNRESET` | The peer reset the connection — which can happen after the request was fully sent, and even after it was processed |
| `ETIMEDOUT` | A timeout says only that no answer came back |
| `EPIPE` | The socket closed mid-write; some bytes may have gone |
| `ABORT_ERR` | We gave up. The provider did not necessarily |
| `UND_ERR_*` | undici's own timeouts, all post-connection |
| **any HTTP status** | An HTTP response existing at all proves the request arrived. A 500 says the provider's web tier had a problem; it says nothing about the refund it may already have accepted |

### The correction this policy carries

The approved design classified HTTP 5xx as a definite failure. The senior
review corrected that before implementation, and the corrected rule is the one
above: **an HTTP status never decides whether the financial operation
happened.** Only two things produce `failed` —

1. a stage of `not_transmitted`, or
2. a provider statement that **no refund was created**, carried in
   `RefundResult.notExecutedEvidence`.

A bare `status: "failed"` with no evidence is downgraded to `in_doubt`, because
a refund the provider rejected and a refund the provider accepted and then
reported badly are indistinguishable from here.

## The state machine

Five states. `succeeded` is the only terminal one.

| From | To | When |
|---|---|---|
| `owed` | `in_flight` | A finance user authorises execution |
| `in_flight` | `succeeded` | The provider says so, and names the refund |
| `in_flight` | `failed` | Proven not transmitted, or a documented rejection with evidence |
| `in_flight` | `in_doubt` | Anything else, including a crash recovered by the sweeper |
| `failed` | `in_flight` | A retry — there is nothing to duplicate |
| `in_doubt` | `succeeded` | Evidence says the money went back |
| `in_doubt` | `failed` | Evidence says it did not |

**`in_doubt → in_flight` is forbidden.** There is no flag, option, override or
operator action that permits it. To retry an unknown you must first resolve it
to `failed`, and resolving to `failed` requires evidence. The evidence is the
unlock, not the operator's patience.

`refund_due` remains a **terminal order state**. The order records that a
refund is owed; the refund records what happened. One fact, one place.

## Who starts a refund

**Recording is automatic. Paying is not.**

The `refunds` row is created inside the same transaction that moves the order
to `refund_due`, so no crash, missed sweep or forgotten query can lose the
debt. Money leaving requires a finance user holding `refund.execute` **and**
step-up elevation — holding the permission says they are allowed in principle,
elevation says they are present right now.

The scheduler endpoint continues an authorisation a human already gave. It
sweeps unanswered requests to `in_doubt`, asks the provider about unknowns, and
retries refunds that are provably safe to retry **and** already have a
`requested_by_user_id`. It never touches `owed`.

## Double refund: four independent layers

1. `UNIQUE (payment_id)` — one payment can only ever have one refund.
2. A row lock (`for update`) — two operators pressing at once serialise.
3. A guarded transition — every UPDATE names the state it expects, so a stale
   caller matches no rows.
4. **The attempt row is committed before the provider is called.**

The fourth is the crash window's only defence. If the process dies one
instruction after the commit, what remains is a refund marked `in_flight` and
an attempt with no `finished_at` — a request that *may* be out there. Writing
the attempt afterwards would make a crash indistinguishable from a refund that
was never attempted, and "never attempted" is the reading that pays twice.

The idempotency key is derived — `refund:{refund_id}:{attempt_no}` — never
supplied by a caller.

## Manual reconciliation

There is **no "mark as refunded"**. Not hidden behind a permission, not
disabled — absent from the interface and from the API. A `succeeded` refund
that names no resolution source, no evidence and no provider reference is
refused by a CHECK constraint, so the button could not have worked.

What exists instead is a two-step reconciliation:

- one person **proposes** what a provider statement says, supplying an external
  reference (required to claim a success) and the evidence;
- a **different** person confirms, and only then does the refund move.

The second-person requirement adapts to the deployment, and the reason is
honesty rather than convenience. A dual-control rule that cannot be satisfied
is not a control — it is a rule people work around, usually by sharing a login.
So the confirmer must be a different person **whenever a different person holds
`refund.reconcile_manual`**, counted in SQL at the moment of confirmation. When
exactly one holder exists, the same person may confirm and the refund records
`reconciliation_mode = 'single_operator'` — visible, countable, and reported by
a reconciliation detector rather than silently identical to dual control.

That adaptation is not a hole an operator can open: changing the number of
holders needs `admin.role.grant`, which the `finance` role deliberately does
not hold.

## What this phase does NOT do

- **No ledger posting.** Phase 2 posts no capture, so a reversal would have
  nothing to reverse and would make the books *less* true. Ledger treatment
  belongs to Settlement.
- **No partial refunds.** Every `refund_due` today is a full non-fulfilment.
  The amount column exists, so partials are a later change rather than a
  rewrite.
- **No cancellation.** A refund that is owed stays owed.
- **No SMS.** Resolutions write to a provider-neutral outbox. Nothing delivers
  from it and nothing marks a row `sent`, because no provider has been chosen
  for Niger — see `docs/providers/sms/README.md`.
- **No iPayMoney.** The adapter throws. See
  `docs/providers/ipaymoney/README.md` for the ten refund facts still required,
  two of which are design-changing.
- **No worker daemon.** A domain function and an authenticated endpoint an
  external scheduler can invoke. Building a daemon would be building a
  scheduler, not refund logic.

## Retry policy

Configuration, in `platform_settings`, clamped so it can only ever be
**gentler**:

| Setting | Default | Clamp |
|---|---|---|
| `refund.max_attempts` | 3 | **downward** — configuration may permit fewer, never more |
| `refund.retry_backoff_seconds` | 300 | **upward** — may wait longer, never less |
| `refund.stuck_in_flight_seconds` | 900 | **upward** — may be more patient before declaring unknown |
| `refund.queue_batch_size` | 20 | **downward** |

A malformed value — a string, a negative, `null`, a missing key — falls back to
the reviewed default rather than to "no limit". A broken setting must never
open a gate.

## Reconciliation

Ten detectors, in `packages/core/src/ledger/commerce-reconcile.ts`, each
querying for a state the refund machine says is unreachable:
`refund_due_without_refund_record`, `refund_without_refund_due_order`,
`refund_of_unsucceeded_payment`, `refund_amount_mismatch`,
`multiple_refunds_for_payment`, `refund_succeeded_without_evidence`,
`refund_failed_without_evidence`, `stuck_in_flight`,
`refund_attempt_never_finished`, `manual_reconciliation_single_operator`.

CI runs them and additionally **proves they still detect**: the gate builds a
consistent refund, requires silence, breaks the frozen amount, requires the
detector to speak, and cleans up. A reconciliation that cannot report a fault
is not a gate.

## Where this lives

| Concern | File |
|---|---|
| The classification rule | `packages/core/src/payments/refund-outcome.ts` |
| The state machine | `packages/core/src/refunds/state.ts` |
| Recording a debt, reading the queue | `packages/core/src/refunds/record.ts` |
| Execution, resolution, the queue processor | `packages/core/src/refunds/execute.ts` |
| Manual reconciliation | `packages/core/src/refunds/reconcile-manual.ts` |
| Clamped retry policy | `packages/core/src/refunds/policy.ts` |
| The notification outbox | `packages/core/src/notifications/index.ts` |
| Schema and constraints | `packages/db/migrations/0012_refund_execution.sql` |
| Detectors | `packages/core/src/ledger/commerce-reconcile.ts` |
| Operator queue | `apps/web/src/app/[locale]/admin/refunds/` |
