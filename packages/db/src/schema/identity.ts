import { sql } from "drizzle-orm";
import {
  char, check, index, inet, integer, pgTable, smallint,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { countries } from "./reference";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  countryCode: char("country_code", { length: 2 }).references(() => countries.code),
  locale: text("locale").notNull().default("fr"),
  status: text("status").notNull().default("active"), // active | suspended | closed
  /**
   * Link to Better Auth's credential record. `users` stays the domain identity
   * — what role_assignments, consent_records, audit_logs and ledger accounts
   * reference — while Better Auth owns credentials and sessions.
   */
  authUserId: text("auth_user_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    purpose: text("purpose").notNull(), // step_up only — see the table comment
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
    check("otp_purpose_step_up_only", sql`${t.purpose} = 'step_up'`),
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
