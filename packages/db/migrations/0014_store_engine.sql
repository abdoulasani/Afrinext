-- The universal store engine.
--
-- One Store entity, six businesses. The type decides how the store PRESENTS —
-- which vocabulary, which sections, which dashboard — never what it IS. The
-- underlying row stays generic so a formation, a mechanic and a photographer
-- are the same thing to orders, payments, authorization and reconciliation.

ALTER TABLE stores ADD COLUMN store_type text NOT NULL DEFAULT 'digital_product';
ALTER TABLE stores ADD CONSTRAINT stores_type_valid CHECK (
  store_type IN ('formation','digital_product','physical_product','service','creator','delivery')
);

-- The longer "about" text, distinct from the one-line tagline.
ALTER TABLE stores ADD COLUMN description text;
ALTER TABLE stores ADD CONSTRAINT stores_description_length CHECK (
  description IS NULL OR char_length(description) <= 2000
);

-- Where the store operates. The country was already here (0007); the city is
-- what a Niamey buyer actually filters by.
ALTER TABLE stores ADD COLUMN city text;
ALTER TABLE stores ADD CONSTRAINT stores_city_length CHECK (
  city IS NULL OR char_length(btrim(city)) BETWEEN 2 AND 80
);

-- A PUBLIC business contact, entered by the owner for buyers to call.
-- Deliberately not the owner's sign-in number: that one authenticates a
-- person and is nobody else's business.
ALTER TABLE stores ADD COLUMN contact_phone text;
ALTER TABLE stores ADD CONSTRAINT stores_contact_phone_shape CHECK (
  contact_phone IS NULL OR contact_phone ~ '^\+?[0-9][0-9 ]{6,18}[0-9]$'
);

-- Visual identity, from a curated palette rather than an upload.
--
-- A brand is a named color story the design system knows how to render as a
-- cover, an avatar and accents. Uploads are a later, deliberate milestone:
-- public image hosting is a moderation and abuse surface this milestone must
-- not casually acquire.
ALTER TABLE stores ADD COLUMN brand text NOT NULL DEFAULT 'laterite';
ALTER TABLE stores ADD CONSTRAINT stores_brand_valid CHECK (
  brand IN ('laterite','indigo','forest','ochre','aubergine','sable')
);

-- When the store first went public. What "newest stores" actually orders by —
-- and set once, so re-publishing cannot bump a store back to the top.
ALTER TABLE stores ADD COLUMN published_at timestamptz;
UPDATE stores SET published_at = updated_at WHERE status = 'published';
ALTER TABLE stores ADD CONSTRAINT stores_published_has_timestamp CHECK (
  status <> 'published' OR published_at IS NOT NULL
);

ALTER TABLE stores ADD COLUMN suspended_at timestamptz;

-- The marketplace's two hot paths: newest published, and published-by-type.
CREATE INDEX stores_public_newest_idx ON stores (published_at DESC) WHERE status = 'published';
CREATE INDEX stores_public_type_idx ON stores (store_type) WHERE status = 'published';
