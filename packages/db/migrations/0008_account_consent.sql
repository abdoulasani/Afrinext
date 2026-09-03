-- Phase 2: a new account is not usable until the general terms are accepted.
--
-- The enforcement point is one that already existed. `resolveActor` returns no
-- actor for any user whose status is not 'active' — that is how suspension has
-- always worked — so a new status is all that is needed to make a freshly
-- created account hold credentials and grant nothing. No part of the OTP flow,
-- the code storage, the rate limits or the attempt bounds is touched.

-- 'pending_consent' joins the set. The constraint did not exist before; adding
-- it now means a typo in a status can no longer silently deactivate an account
-- or, worse, activate one.
ALTER TABLE users
  ADD CONSTRAINT users_status_valid
  CHECK (status IN ('pending_consent', 'active', 'suspended', 'closed'));

COMMENT ON COLUMN users.status IS
  'pending_consent: created, holds credentials, resolves to no actor until the '
  'general terms are accepted. active: usable. suspended/closed: keeps '
  'credentials, loses its actor.';
