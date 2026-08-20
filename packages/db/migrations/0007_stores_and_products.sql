-- Phase 2, milestone 2: stores and digital products.
--
-- The first product vertical. Deliberately narrow: digital products only, no
-- inventory, no delivery, no checkout. What it does carry is the money model —
-- a price is minor units plus a currency, never a float and never a bare
-- number — and the authorization model, where a store is a scope.

CREATE TABLE stores (
  id              uuid PRIMARY KEY,
  owner_user_id   uuid NOT NULL REFERENCES users(id),
  slug            text NOT NULL,
  name            text NOT NULL,
  tagline         text,
  country_code    text REFERENCES countries(code),
  status          text NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_status_valid CHECK (status IN ('draft', 'published', 'suspended')),
  -- The slug is in the URL. Constrain its shape here rather than trusting every
  -- future caller to have run the same regex.
  CONSTRAINT stores_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 48)
);
CREATE UNIQUE INDEX stores_slug_key ON stores (slug);
CREATE INDEX stores_owner_idx ON stores (owner_user_id);

CREATE TABLE products (
  id            uuid PRIMARY KEY,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  kind          text NOT NULL DEFAULT 'digital',
  title         text NOT NULL,
  summary       text,
  description   text,
  -- Minor units. The exponent comes from currencies.minor_unit, so XOF's zero
  -- decimals are data. Dividing by 100 anywhere is a bug across all of UEMOA.
  price_minor   bigint NOT NULL,
  currency      text NOT NULL REFERENCES currencies(code),
  status        text NOT NULL DEFAULT 'draft',
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_kind_valid CHECK (kind IN ('digital')),
  CONSTRAINT products_status_valid CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT products_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 64),
  -- A paid product that is free or negative is not a state worth having.
  CONSTRAINT products_price_positive CHECK (price_minor > 0),
  -- "Published" without a timestamp is a label with nothing behind it.
  CONSTRAINT products_published_has_timestamp CHECK (status <> 'published' OR published_at IS NOT NULL)
);
-- Unique within a store, not globally: two sellers may both have 'ebook'.
CREATE UNIQUE INDEX products_store_slug_key ON products (store_id, slug);
CREATE INDEX products_store_idx ON products (store_id);
CREATE INDEX products_published_idx ON products (status, published_at);

COMMENT ON COLUMN products.price_minor IS
  'Minor units of products.currency. The exponent is currencies.minor_unit; '
  'XOF and XAF are zero-decimal, so this is whole francs for the launch market.';

-- The `seller` role that carries store.create is defined in the seed with every
-- other role, NOT here. Roles and permissions are reference data, and reference
-- data has one source. Inserting it in this migration also happens to be
-- impossible on a fresh database: migrations run before the seed, so the
-- permissions row it would reference does not exist yet.
