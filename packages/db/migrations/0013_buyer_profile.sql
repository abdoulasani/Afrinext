-- Buyer profile: a real name, and a country somebody chose.
--
-- iPayMoney requires `customer_name` on every charge. Afrinext had no name to
-- give: `users.display_name` holds the synthetic address signup mints
-- (22790123456@phone.afrinext.local) and Better Auth's `user.name` holds the
-- phone string. Both are placeholders written to satisfy a NOT NULL, and
-- sending either to a payment provider would be inventing a value for a
-- required field — the thing the checkout wiring milestone refused to do.
--
-- So the name gets its own column rather than reusing `display_name`. That is
-- not tidiness: `display_name` is already populated for every existing account
-- with a value that is not a name, so a column that is NULL until a person
-- actually supplies one is the only way "we have a real name" is expressible at
-- all. `full_name IS NOT NULL` means a human typed it.
--
-- The country is NOT new. `users.country_code` has existed since 0001 with a
-- foreign key to `countries`; no signup path has ever written it. This gives it
-- a writer rather than giving it a duplicate.

ALTER TABLE users ADD COLUMN full_name text;

-- Shape only, deliberately.
--
-- Two characters minimum rejects an empty string and a stray keystroke; 120
-- accepts names far longer than any this platform will meet. Nothing here
-- constrains the CHARACTERS: a rule that assumed Latin letters would reject
-- legitimate names, and a payment platform in West Africa is exactly the wrong
-- place to be confidently wrong about what a name may contain. Normalisation —
-- trimming, collapsing runs of whitespace — happens in the domain before the
-- value arrives; this is the backstop that a bypass still cannot store junk.
ALTER TABLE users ADD CONSTRAINT users_full_name_shape
  CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 2 AND 120);

COMMENT ON COLUMN users.full_name IS
  'The buyer''s own name, supplied by them after sign-in. NULL until they do. '
  'Never derived from display_name, from Better Auth''s name column, or from a '
  'phone number. This is the value sent to a payment provider as customer_name.';

COMMENT ON COLUMN users.country_code IS
  'The country the person says they are in, chosen by them. Never inferred from '
  'a phone prefix and never taken from the store being bought from.';
