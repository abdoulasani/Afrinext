# Late payment policy

**Status:** decided and implemented. Phase 2 financial review gate.
**Decided by:** the senior review, on the proposal in the same gate.
**Applies to:** every payment provider, present and future. Nothing here is
provider-specific, and nothing here assumes anything about iPayMoney.

## The situation

A buyer opens a checkout. The order is priced and given a lifetime. The buyer
goes to the provider to pay. The checkout lapses. **Then the provider confirms
the payment.**

The money has moved in the real world. Our timer has no opinion about that.

## The rule

A verified successful payment is **never ignored**. What it does depends on
when it arrives and on whether fulfilling is still safe.

| When the payment is verified | Conditions | Order becomes |
|---|---|---|
| While the order is `pending_payment` | the ordinary path | `paid` — entitlement granted, fee schedule frozen |
| After expiry, **at or before** expiry + 24 h | product still published, store still published, buyer does not already own it | `paid` — entitlement granted, fee schedule frozen, `late_payment_at` set |
| After expiry, **more than** 24 h later | — | `refund_due` |
| After expiry, within 24 h, but any condition fails | — | `refund_due` |

The boundary is inclusive: **grace applies when the payment is verified at or
before `expires_at + 24 hours`.** One millisecond later is `refund_due`.

A verified **failed** payment after expiry is just a failure. No money arrived,
so there is nothing to refund and nothing to fulfil; the order stays `expired`.

## What `refund_due` means

> Payment successfully confirmed, but Afrinext did not fulfil the order and
> must later execute a refund through the appropriate payment provider.

It is a **queue and a state**. It is **not** an executed refund, not a refund
request sent to anybody, and not a credit. **No refund execution exists in the
codebase.** Nothing drains this queue yet.

## State machine

```
                      ┌──────────────────┐
                      │ pending_payment  │
                      └────────┬─────────┘
             ┌─────────────┬───┴────┬─────────────┐
             ▼             ▼        ▼             ▼
          ┌──────┐   ┌──────────┐ ┌───────────┐ ┌─────────┐
          │ paid │   │  failed  │ │ cancelled │ │ expired │
          └──────┘   └──────────┘ └───────────┘ └────┬────┘
             ▲                                       │
             │  late payment, inside grace,          │
             │  and still safe to fulfil             │
             └───────────────────────────────────────┤
                                                     │
                          late payment, outside      │
                          grace or unsafe            ▼
                                            ┌──────────────┐
                                            │  refund_due  │
                                            └──────────────┘
```

`expired` is the only state an order can leave, and only because money can
arrive after it. `paid`, `failed`, `cancelled` and `refund_due` are terminal.

Payments are unchanged: `initiated → pending → succeeded | failed | cancelled |
expired`, each terminal.

## Configuration

| Setting | Value | Behaviour |
|---|---|---|
| `checkout.ttl_seconds` | `1800` (30 minutes) | How long an unpaid order stays payable. Seeded; the code default is a fallback, not the source. |
| `checkout.late_payment_grace_seconds` | `86400` (24 hours) | Read as a **ceiling**. The loader clamps to it, so an operator may narrow the window; widening it past a day is a policy change, not an `UPDATE`. A malformed value falls back to 24 h rather than to zero or to no limit. |

### Why 24 hours

Mobile-money confirmations in Niger travel through a carrier and an aggregator
before they reach Afrinext. A delay of seconds is ordinary and a delay of hours
happens. Refusing to fulfil those would take money from people who genuinely
paid and hand every one of them to support, for no benefit to anybody.

Beyond a day the balance tips: the buyer has moved on, may have bought again,
and fulfilment becomes a surprise rather than a service. A refund is the honest
answer there.

## Financial invariants

1. **No successful payment is invisible.** Every `succeeded` payment leaves its
   order in `paid` or `refund_due`. Nothing else is a legal resting place.
2. **No double fulfilment.** One entitlement per buyer per product, enforced by
   a unique index. A late payment for something the buyer already owns becomes
   `refund_due` rather than being silently consumed.
3. **No double charge absorbed in silence.** If a buyer paid twice, the second
   payment is queued for refund and countable.
4. **Fee snapshots are unchanged.** A late-accepted order freezes its commission
   exactly as an on-time one does, through the same code path.
5. **The ledger is untouched.** Neither acceptance nor `refund_due` posts a
   ledger entry. Payment confirmation and financial settlement remain separate,
   and settlement is not implemented.

## Concurrency

The confirmation transaction takes `SELECT … FOR UPDATE` on the order row before
deciding anything. A confirmation and the expiry sweeper therefore queue rather
than interleave: whichever arrives second sees the state the first committed and
takes the branch that state deserves. Both are guarded `UPDATE`s naming the state
they expect, so a lost race writes nothing.

## Commerce reconciliation

`reconcileCommerce()` looks for the states this machine says are impossible:

1. a `succeeded` payment whose order is neither `paid` nor `refund_due`;
2. a `paid` order with no `succeeded` payment;
3. more than one `succeeded` payment for one order;
4. a `refund_due` order with no `succeeded` payment;
5. duplicate entitlements for one buyer and product.

CI asserts the result is empty, and separately proves the detector can still
report a fault by breaking one invariant deliberately and requiring it to be
caught.

## Not implemented

- Refund **execution**, through any provider.
- Any iPayMoney integration.
- Settlement, seller wallets, payouts.
- Any automatic notification to the buyer that a refund is owed.
- Any operator screen listing the `refund_due` queue.
