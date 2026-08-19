-- Retire the tables Better Auth now owns.
--
-- Two session stores would make revocation ambiguous, and two credential stores
-- would make "which password is current?" unanswerable. Neither table has ever
-- held a row - nobody has ever signed in - so this drops nothing real.
--
-- NOT dropped: users, roles, permissions, role_assignments, consent_records,
-- audit_logs and the entire ledger. Authorization, consent and money remain
-- entirely Afrinext's. otp_challenges is kept, narrowed by CHECK constraint to
-- step-up re-verification, so Afrinext's payout elevation challenge and Better
-- Auth's sign-in OTP never overlap.

DROP TABLE "sessions" CASCADE;--> statement-breakpoint
DROP TABLE "user_identities" CASCADE;