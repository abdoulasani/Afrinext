-- Phase 2, financial review gate: the late-payment policy.
--
-- A verified successful payment can arrive after the checkout expired. The
-- money is real whatever our timer did, so it can never be ignored — the only
-- question is whether fulfilling is still safe. Two ends for an expired order:
--
--   expired → paid        inside the grace window and still safe to fulfil;
--   expired → refund_due  it is not, and Afrinext owes the buyer their money.
--
-- refund_due means: payment successfully confirmed, Afrinext did NOT fulfil the
-- order, and a refund must later be executed through the payment provider. It
-- is a QUEUE. Nothing in this milestone executes a refund, and nothing here
-- touches the ledger. See docs/architecture/late-payment-policy.md.

ALTER TABLE orders DROP CONSTRAINT orders_status_valid;
ALTER TABLE orders ADD CONSTRAINT orders_status_valid
  CHECK (status IN ('pending_payment', 'paid', 'failed', 'cancelled', 'expired', 'refund_due'));

-- When a payment arrived after expiry, whichever way it was then decided. The
-- audit log holds the reasoning; this column is what makes the case countable
-- without reading it.
ALTER TABLE orders ADD COLUMN late_payment_at timestamptz;

-- A late acceptance is a paid order, and a paid order must know when it was
-- paid. Nothing about that changes; this states the second half explicitly.
ALTER TABLE orders ADD CONSTRAINT orders_late_payment_after_expiry
  CHECK (late_payment_at IS NULL OR late_payment_at >= expires_at);

CREATE INDEX orders_refund_due_idx ON orders (status, late_payment_at)
  WHERE status = 'refund_due';

-- Both windows are configuration, and both are now written down rather than
-- living as a fallback in code.
INSERT INTO platform_settings (key, value, description) VALUES (
  'checkout.ttl_seconds',
  '1800'::jsonb,
  'How long an unpaid order stays payable. 30 minutes.'
) ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value, description) VALUES (
  'checkout.late_payment_grace_seconds',
  '86400'::jsonb,
  'How long after expiry a verified successful payment may still fulfil the '
  'order. 24 hours. Read as a CEILING, never a default: the loader clamps to '
  'this reviewed maximum, so an operator may narrow the window but widening it '
  'is a policy change, not an UPDATE.'
) ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN orders.late_payment_at IS
  'Set when a verified payment arrived after expiry, whether the order was then '
  'fulfilled (status paid) or queued for refund (status refund_due).';
