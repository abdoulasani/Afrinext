-- Phase 2, milestone 5: digital delivery.
--
-- The files behind a paid digital product, and the entitlement state that
-- decides who may read them. No settlement, no payouts, no refunds, and no
-- course structure: this is the generic asset-and-access layer those would
-- later be built on.

CREATE TABLE digital_assets (
  id                uuid PRIMARY KEY,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title             text NOT NULL,
  -- Coarse on purpose. 'video' is a later milestone's word, and inventing it
  -- here would imply a player, a transcoder and a lesson model that do not exist.
  kind              text NOT NULL DEFAULT 'document',
  content_type      text NOT NULL,
  byte_size         bigint NOT NULL,
  checksum_sha256   text NOT NULL,
  -- Opaque, server-side only. Not a URL, not a path a client can construct,
  -- and not derived from anything a client knows.
  storage_key       text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digital_assets_kind_valid CHECK (kind IN ('document', 'file')),
  CONSTRAINT digital_assets_size_positive CHECK (byte_size > 0)
);
CREATE INDEX digital_assets_product_idx ON digital_assets (product_id, sort_order);
CREATE UNIQUE INDEX digital_assets_storage_key ON digital_assets (storage_key);

-- What a buyer may do with the files once entitled. A POLICY, not a protection:
-- anything a browser can render, a determined person can save. Nothing in this
-- codebase calls view_only "DRM", because it is not.
ALTER TABLE products
  ADD COLUMN delivery_mode text NOT NULL DEFAULT 'download';
ALTER TABLE products
  ADD CONSTRAINT products_delivery_mode_valid
  CHECK (delivery_mode IN ('download', 'view_only'));

-- Revocation. Set, never deleted: the grant happened, and that it happened is
-- part of why someone had access last month. Access reads `revoked_at IS NULL`,
-- so a revocation takes effect on the next request rather than the next login.
--
-- Nothing in this milestone revokes — that is a refund decision, and refunds
-- are out of scope. The column exists so "a revoked entitlement grants nothing"
-- can be tested today rather than asserted later.
ALTER TABLE entitlements ADD COLUMN revoked_at timestamptz;
ALTER TABLE entitlements ADD COLUMN revoked_reason text;
CREATE INDEX entitlements_live_idx ON entitlements (user_id, product_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE digital_assets IS
  'Files behind a digital product. storage_key is opaque and never leaves the '
  'server; bytes are reachable only through an authorized route that re-checks '
  'the entitlement on every request.';
COMMENT ON COLUMN products.delivery_mode IS
  'download | view_only. A seller policy, not a technical protection.';
