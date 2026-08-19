-- Review decision 1: phone verification codes come back to otp_challenges.
--
-- Phase 1 handed phone sign-in to Better Auth, which stores the code in
-- verification.value as '<code>:<attempts>' in the clear. A single read of that
-- table is an account takeover for everyone with a code in flight. The code now
-- lives here again, as a keyed hash and nothing else, and Better Auth keeps only
-- what it should: the credential row and the session.

-- 'sign_in' was forbidden while Better Auth owned the flow. It is ours again.
ALTER TABLE otp_challenges DROP CONSTRAINT IF EXISTS otp_purpose_step_up_only;
ALTER TABLE otp_challenges
  ADD CONSTRAINT otp_purpose_valid
  CHECK (purpose IN ('sign_in', 'verify_identity', 'step_up'));

-- One live challenge per identifier and purpose. Enforced here rather than in
-- application code because the alternative is a read-then-write that two
-- simultaneous requests interleave: both see no live challenge, both insert,
-- and the caller ends up holding two codes with a full attempt budget each.
CREATE UNIQUE INDEX otp_one_live_challenge
  ON otp_challenges (kind, identifier, purpose)
  WHERE consumed_at IS NULL;

-- Nothing should ever write a phone code into Better Auth's table again. The
-- test suite asserts it, and this comment is where a reviewer looks for why.
COMMENT ON TABLE otp_challenges IS
  'The only store for one-time codes. code_hash is HMAC-SHA256 keyed with a '
  'key derived from the application secret, so a stolen copy of this table '
  'cannot be brute-forced back to six-digit codes without the secret too.';

-- Rate limits are configuration, not business logic (review decision 7).
INSERT INTO platform_settings (key, value, description) VALUES (
  'auth.otp_policy',
  '{"perPhonePerHour":5,"perIpPerHour":20,"cooldownMs":60000,"verificationAttempts":5,"ttlMs":300000,"stepUpPerHour":3}'::jsonb,
  'OTP issuance and verification limits. Approved for launch; the per-IP limit is the production-tuning point — carrier NAT in Niger puts many subscribers behind one address.'
) ON CONFLICT (key) DO NOTHING;
