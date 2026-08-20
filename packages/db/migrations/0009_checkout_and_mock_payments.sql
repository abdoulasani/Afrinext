-- Phase 2, milestone: checkout against a mock payment provider.
--
-- The order domain and the payment state machine. Deliberately NOT settlement:
-- nothing here posts to the ledger. A confirmed payment records that a provider
-- says it captured funds, freezes the commission split, and grants access. It
-- does not create a seller's entitlement to money — that is a separate step
-- that needs a real provider settlement event, a refund window, and payout
-- rails, none of which exist yet. See the milestone note.

CREATE TABLE orders (
  id              uuid PRIMARY KEY,
  buyer_user_id   uuid NOT NULL REFERENCES users(id),
  store_id        uuid NOT NULL REFERENCES stores(id),
  -- The buyer's idempotency key. Unique per buyer, so a double submit resolves
  -- to the order that already exists rather than a second one.
  checkout_key    text NOT NULL,
  status          text NOT NULL DEFAULT 'pending_payment',
  -- Minor units, recomputed server-side from the product rows. Never a figure
  -- the client sent.
  total_minor     bigint NOT NULL,
  currency        char(3) NOT NULL REFERENCES currencies(code),
  expires_at      timestamptz NOT NULL,
  paid_at         timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_valid
    CHECK (status IN ('pending_payment', 'paid', 'failed', 'cancelled', 'expired')),
  CONSTRAINT orders_total_positive CHECK (total_minor > 0),
  CONSTRAINT orders_paid_has_timestamp CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
CREATE UNIQUE INDEX orders_buyer_checkout_key ON orders (buyer_user_id, checkout_key);
CREATE INDEX orders_buyer_idx ON orders (buyer_user_id, created_at);
CREATE INDEX orders_store_idx ON orders (store_id, created_at);
CREATE INDEX orders_open_idx ON orders (status, expires_at);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY,
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id),
  store_id          uuid NOT NULL REFERENCES stores(id),
  -- Snapshots, not joins. A join would show today's price on last month's
  -- receipt, and the seller could change it.
  title_snapshot    text NOT NULL,
  unit_price_minor  bigint NOT NULL,
  currency          char(3) NOT NULL REFERENCES currencies(code),
  quantity          integer NOT NULL DEFAULT 1,
  line_total_minor  bigint NOT NULL,
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_price_positive CHECK (unit_price_minor > 0),
  -- The line total is arithmetic, not a field a caller may set independently.
  CONSTRAINT order_items_line_total_consistent
    CHECK (line_total_minor = unit_price_minor * quantity)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE UNIQUE INDEX order_items_order_product_key ON order_items (order_id, product_id);

CREATE TABLE payments (
  id               uuid PRIMARY KEY,
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  provider_ref     text,
  status           text NOT NULL DEFAULT 'initiated',
  amount_minor     bigint NOT NULL,
  currency         char(3) NOT NULL REFERENCES currencies(code),
  idempotency_key  text NOT NULL,
  confirmed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_status_valid
    CHECK (status IN ('initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'expired')),
  CONSTRAINT payments_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT payments_succeeded_has_timestamp
    CHECK (status <> 'succeeded' OR confirmed_at IS NOT NULL)
);
CREATE UNIQUE INDEX payments_idempotency_key ON payments (idempotency_key);
CREATE UNIQUE INDEX payments_provider_ref_key ON payments (provider, provider_ref);
CREATE INDEX payments_order_idx ON payments (order_id);

-- At most ONE unsettled attempt per order. Two live charges against one order
-- is how a buyer gets billed twice, so it is refused by an index rather than by
-- a check somebody has to remember to write.
CREATE UNIQUE INDEX payments_one_live_per_order
  ON payments (order_id)
  WHERE status IN ('initiated', 'pending');

CREATE TABLE payment_events (
  id                 uuid PRIMARY KEY,
  payment_id         uuid REFERENCES payments(id) ON DELETE CASCADE,
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  provider_ref       text NOT NULL,
  type               text NOT NULL,
  reported_status    text NOT NULL,
  outcome            text NOT NULL,
  reason             text,
  payload            text NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_outcome_valid CHECK (outcome IN ('applied', 'ignored', 'rejected'))
);
-- The unique key is what makes a replayed webhook a no-op at the database
-- rather than a race in application code.
CREATE UNIQUE INDEX payment_events_provider_event_key
  ON payment_events (provider, provider_event_id);
CREATE INDEX payment_events_payment_idx ON payment_events (payment_id, received_at);

CREATE TABLE entitlements (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  product_id  uuid NOT NULL REFERENCES products(id),
  order_id    uuid NOT NULL REFERENCES orders(id),
  source      text NOT NULL DEFAULT 'purchase',
  granted_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_source_valid CHECK (source IN ('purchase', 'grant'))
);
-- One grant per buyer per product, whatever happens upstream: a replayed
-- confirmation, a concurrent one, or a second order cannot produce two.
CREATE UNIQUE INDEX entitlements_user_product_key ON entitlements (user_id, product_id);
CREATE INDEX entitlements_user_idx ON entitlements (user_id, granted_at);

-- Provider events are evidence. Evidence that can be rewritten is not evidence,
-- and the refused ones are exactly the rows an incident review needs.
CREATE OR REPLACE FUNCTION payment_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment_events is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_events_no_update
  BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION payment_events_append_only();

COMMENT ON TABLE orders IS
  'Buyer intent, priced server-side. A paid order means a provider confirmed a '
  'capture; it does NOT mean the seller has been credited — settlement is a '
  'separate step and is not implemented yet.';
COMMENT ON TABLE entitlements IS
  'Granted only inside the transaction that marks an order paid. Access is read '
  'from here, never inferred from an order status at read time.';
