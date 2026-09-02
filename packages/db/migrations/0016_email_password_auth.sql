-- Email + password authentication, and the programme a person chose.
--
-- Everything here is ADDITIVE. No column is dropped, no CHECK is loosened, and
-- no existing row is rewritten. Phone accounts keep their credentials, their
-- sessions, their roles and their synthetic @phone.afrinext.local address; this
-- migration gives the new path somewhere to write and nothing else.

-- ---------------------------------------------------------------------------
-- 1. Two more things a one-time code can be for
-- ---------------------------------------------------------------------------
--
-- Verification and reset codes belong in otp_challenges rather than in Better
-- Auth's `verification` table, for the same reason phone codes were moved back
-- here in 0006: this table stores a keyed hash and nothing else, and it is
-- PostgreSQL — not application code — that enforces single use, expiry and the
-- attempt ceiling. Two stores for one kind of secret is one store too many.
ALTER TABLE otp_challenges DROP CONSTRAINT IF EXISTS otp_purpose_valid;
ALTER TABLE otp_challenges
  ADD CONSTRAINT otp_purpose_valid
  CHECK (purpose IN (
    'sign_in', 'verify_identity', 'step_up',
    'email_verification', 'password_reset'
  ));

-- ---------------------------------------------------------------------------
-- 2. The programme a person chose
-- ---------------------------------------------------------------------------
--
-- A DECLARED INTENT, and deliberately nothing more. It grants no role, unlocks
-- no feature and is never consulted by authorize(). It exists so the signup
-- choice is remembered and so the Entrepreneur offer can be addressed to the
-- people who asked for it.
--
-- Every existing account defaults to 'vendeur', which is what they already are:
-- selling is free, and no one has ever been charged for anything.
--
-- It is a column on users rather than a row somewhere else because a person has
-- exactly one current programme, and because moving from vendeur to
-- entrepreneur must be an UPDATE on the account somebody already has — never a
-- second account.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS programme TEXT NOT NULL DEFAULT 'vendeur';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_programme_valid;
ALTER TABLE users
  ADD CONSTRAINT users_programme_valid
  CHECK (programme IN ('vendeur', 'entrepreneur'));

-- ---------------------------------------------------------------------------
-- 3. The Entrepreneur subscription, kept apart from the choice
-- ---------------------------------------------------------------------------
--
-- Separated from users.programme precisely because CHOOSING IS NOT PAYING. A
-- row here is a billing lifecycle; the column above is a preference. Conflating
-- them is how somebody ends up shown as a paying subscriber because they
-- clicked a card during signup.
--
-- Afrinext cannot currently charge anyone: the mock provider is the only one
-- implemented and iPayMoney throws by design. So this table is written by
-- nothing in this milestone. It exists so the state has a shape before there is
-- a payment rail, and so the eventual activation is an INSERT rather than a
-- schema change under time pressure.
--
-- NOTHING READS THIS FOR PERMISSIONS. authorize() is not taught about it here.
CREATE TABLE IF NOT EXISTS programme_subscriptions (
  id                   UUID PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES users(id),
  programme            TEXT NOT NULL,
  status               TEXT NOT NULL,
  -- Frozen at subscription time, like a fee snapshot: a later price change must
  -- not restate what somebody agreed to pay.
  price_minor          BIGINT NOT NULL,
  currency             CHAR(3) NOT NULL REFERENCES currencies(code),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  -- The order that paid for the current period, when one exists. NULL until a
  -- payment rail exists, which is the honest state today.
  order_id             UUID REFERENCES orders(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT programme_subscriptions_programme_valid
    CHECK (programme IN ('entrepreneur')),
  CONSTRAINT programme_subscriptions_status_valid
    CHECK (status IN ('pending_payment', 'active', 'past_due', 'cancelled', 'expired')),
  CONSTRAINT programme_subscriptions_price_positive
    CHECK (price_minor > 0),
  -- An active subscription without a period is a subscription nobody can end.
  CONSTRAINT programme_subscriptions_active_has_period
    CHECK (status <> 'active' OR (current_period_start IS NOT NULL AND current_period_end IS NOT NULL))
);

-- One live subscription per person. A partial index rather than a plain unique
-- constraint, so a cancelled subscription does not block a later one.
CREATE UNIQUE INDEX IF NOT EXISTS programme_subscriptions_one_live
  ON programme_subscriptions (user_id, programme)
  WHERE status IN ('pending_payment', 'active', 'past_due');

CREATE INDEX IF NOT EXISTS programme_subscriptions_by_user
  ON programme_subscriptions (user_id);
