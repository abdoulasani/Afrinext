import { sql } from "drizzle-orm";
import {
  char, check, index, inet, integer, pgTable, smallint,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { countries } from "./reference";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name"),
    /**
     * The buyer's own name, supplied by them after sign-in. NULL until they do.
     *
     * Separate from `displayName` on purpose. `displayName` already holds the
     * synthetic address signup mints for every existing account, so it cannot
     * express "we have a real name"; this column can, because it is NULL until
     * a person types one. It is what a payment provider receives as
     * `customer_name`.
     */
    fullName: text("full_name"),
    /** Chosen by the person. Never inferred from a phone prefix or a store. */
    countryCode: char("country_code", { length: 2 }).references(() => countries.code),
    locale: text("locale").notNull().default("fr"),
    /**
     * pending_consent — created, holds credentials, and resolves to NO ACTOR
     * until the general terms are accepted. Everything other than 'active'
     * behaves that way already; suspension has always worked like this.
     */
    status: text("status").notNull().default("active"),
    /**
     * Link to Better Auth's credential record. `users` stays the domain identity
     * — what role_assignments, consent_records, audit_logs and ledger accounts
     * reference — while Better Auth owns credentials and sessions.
     */
    authUserId: text("auth_user_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "users_status_valid",
      sql`${t.status} in ('pending_consent','active','suspended','closed')`,
    ),
    // Shape only. Nothing constrains which characters a name may contain — a
    // rule that assumed Latin letters would reject legitimate names.
    check(
      "users_full_name_shape",
      sql`${t.fullName} is null or char_length(btrim(${t.fullName})) between 2 and 120`,
    ),
  ],
);

/**
 * Step-up re-verification challenges.
 *
 * Sign-in OTPs are Better Auth's, stored in its `verification` table. This
 * table is narrowed to the Afrinext-specific elevation challenge that guards
 * payout actions, so the two never overlap and there is no question about which
 * store is authoritative for a given code.
 *
 * The code is only ever stored hashed; attempts and expiry are enforced in the
 * database so a brute force cannot be run by racing the application.
 */
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(), // phone | email
    identifier: text("identifier").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull(), // sign_in | verify_identity | step_up
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(5),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    requestedByIp: inet("requested_by_ip"),
  },
  (t) => [
    index("otp_identifier_idx").on(t.kind, t.identifier),
    index("otp_expires_idx").on(t.expiresAt),
    check("otp_attempts_bounded", sql`${t.attempts} >= 0 and ${t.attempts} <= ${t.maxAttempts}`),
    check("otp_kind_valid", sql`${t.kind} in ('phone','email')`),
    check("otp_purpose_valid", sql`${t.purpose} in ('sign_in','verify_identity','step_up')`),
    // One live challenge per identifier and purpose. Without this a caller
    // could bank several usable codes and spend each one's attempt budget.
    uniqueIndex("otp_one_live_challenge")
      .on(t.kind, t.identifier, t.purpose)
      .where(sql`consumed_at is null`),
  ],
);

/** Coarse counter used to rate-limit OTP issuance per identifier and per IP. */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("rate_limit_bucket_window_key").on(t.bucket, t.windowStart)],
);
