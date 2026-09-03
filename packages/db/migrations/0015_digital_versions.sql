-- Phase 5: versioned digital files, licence snapshots and download limits.
--
-- The shape of the problem: a buyer pays for a file. The seller later uploads a
-- corrected one. Whatever else happens, the bytes the buyer paid for and the
-- terms they agreed to must still be exactly what they were at the moment money
-- moved — because a receipt that can be edited afterwards is not a receipt.
--
-- So a product's downloadable payload is versioned, a published version is
-- immutable, and an entitlement names the version it bought rather than the
-- product's current head.

-- ---------------------------------------------------------------------------
-- A version: one immutable snapshot of a product's files and licence.
-- ---------------------------------------------------------------------------
CREATE TABLE product_versions (
  id            uuid PRIMARY KEY,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version_no    integer NOT NULL,
  -- The seller's own words. Afrinext makes no legal claim of its own and
  -- supplies no default text: an absent licence is absent, not implied.
  licence_text  text,
  status        text NOT NULL DEFAULT 'draft',
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_versions_no_positive     CHECK (version_no >= 1),
  CONSTRAINT product_versions_status_valid    CHECK (status IN ('draft', 'published')),
  CONSTRAINT product_versions_published_stamp CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT product_versions_licence_length  CHECK (licence_text IS NULL OR char_length(licence_text) <= 20000),
  CONSTRAINT product_versions_no_unique       UNIQUE (product_id, version_no)
);

CREATE INDEX product_versions_product_idx ON product_versions (product_id, version_no DESC);
-- At most one draft version per product: a seller edits one next version, not
-- a scattering of them.
CREATE UNIQUE INDEX product_versions_one_draft
  ON product_versions (product_id) WHERE status = 'draft';

-- ---------------------------------------------------------------------------
-- Assets belong to a version, not directly to a product.
-- ---------------------------------------------------------------------------
ALTER TABLE digital_assets
  ADD COLUMN version_id uuid REFERENCES product_versions(id) ON DELETE CASCADE;

-- Existing rows predate versioning. Give each product a published version 1 and
-- move its assets there, so no purchased file loses its provenance.
INSERT INTO product_versions (id, product_id, version_no, status, published_at, created_at)
SELECT gen_random_uuid(), p.id, 1, 'published', coalesce(p.published_at, p.created_at), p.created_at
  FROM products p
 WHERE EXISTS (SELECT 1 FROM digital_assets a WHERE a.product_id = p.id);

UPDATE digital_assets a
   SET version_id = v.id
  FROM product_versions v
 WHERE v.product_id = a.product_id AND v.version_no = 1;

ALTER TABLE digital_assets ALTER COLUMN version_id SET NOT NULL;
CREATE INDEX digital_assets_version_idx ON digital_assets (version_id, sort_order);

-- ---------------------------------------------------------------------------
-- Immutability of a published version.
-- ---------------------------------------------------------------------------
--
-- Two separate promises, and they need different mechanisms.
--
-- The first: a published version's LICENCE and identity never change. A plain
-- append-only trigger would also forbid the draft → published transition, so
-- the guard is conditional on the row already being published.
CREATE OR REPLACE FUNCTION reject_published_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'A published product version cannot be deleted (%).', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'published' THEN
    IF NEW.licence_text IS DISTINCT FROM OLD.licence_text
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.status     IS DISTINCT FROM OLD.status
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'A published product version is immutable (%).', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_versions_immutable_once_published
  BEFORE UPDATE OR DELETE ON product_versions
  FOR EACH ROW EXECUTE FUNCTION reject_published_version_change();

-- The second: the FILE SET of a published version never changes. Adding,
-- removing or rewriting an asset under a version somebody has paid for would
-- silently change what they bought, which is the exact failure this milestone
-- exists to prevent.
CREATE OR REPLACE FUNCTION reject_published_asset_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_status text;
  target_version uuid;
BEGIN
  target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT status INTO version_status FROM product_versions WHERE id = target_version;

  IF version_status = 'published' THEN
    RAISE EXCEPTION
      'The files of a published product version cannot be changed (version %).', target_version
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER digital_assets_frozen_when_version_published
  BEFORE INSERT OR UPDATE OR DELETE ON digital_assets
  FOR EACH ROW EXECUTE FUNCTION reject_published_asset_change();

-- ---------------------------------------------------------------------------
-- What the buyer bought: a version, and the licence as it read that day.
-- ---------------------------------------------------------------------------
ALTER TABLE entitlements
  ADD COLUMN version_id       uuid REFERENCES product_versions(id),
  -- A COPY, not a reference. The version's licence is already immutable, but
  -- copying it here means the buyer's terms survive even a future migration
  -- that reorganises versions — and it makes "what did this person agree to?"
  -- answerable from one row.
  ADD COLUMN licence_snapshot text;

UPDATE entitlements e
   SET version_id = v.id,
       licence_snapshot = v.licence_text
  FROM product_versions v
 WHERE v.product_id = e.product_id AND v.version_no = 1;

CREATE INDEX entitlements_version_idx ON entitlements (version_id);

-- ---------------------------------------------------------------------------
-- Download limits, counted rather than decremented.
-- ---------------------------------------------------------------------------
--
-- NULL means unlimited. The limit is per file per buyer: a three-file product
-- should not exhaust its allowance by being fetched once.
ALTER TABLE products
  ADD COLUMN download_limit integer,
  ADD CONSTRAINT products_download_limit_positive
    CHECK (download_limit IS NULL OR download_limit >= 1);

-- One row per delivered file, append-only.
--
-- A counter column would be decremented, and anything decremented can be reset
-- — by a bug, a retry, or somebody with UPDATE. A log cannot be reset without
-- deleting evidence, and DELETE is refused. "How many downloads are left" is
-- therefore a COUNT over facts, never a number somebody stored.
CREATE TABLE entitlement_downloads (
  id             uuid PRIMARY KEY,
  entitlement_id uuid NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES digital_assets(id),
  byte_size      bigint NOT NULL,
  downloaded_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entitlement_downloads_size_positive CHECK (byte_size > 0)
);

CREATE INDEX entitlement_downloads_count_idx
  ON entitlement_downloads (entitlement_id, asset_id);

CREATE TRIGGER entitlement_downloads_append_only
  BEFORE UPDATE OR DELETE ON entitlement_downloads
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

REVOKE UPDATE, DELETE ON entitlement_downloads FROM afrinext_app;
