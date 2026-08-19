import { sql } from "drizzle-orm";
import {
  boolean, char, check, index, inet, integer, pgTable, smallint,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { countries } from "./reference";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  countryCode: char("country_code", { length: 2 }).references(() => countries.code),
  locale: text("locale").notNull().default("fr"),
  status: text("status").notNull().default("active"), // active | suspended | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per credential. A user can hold a phone and an email (and later an
 * OAuth subject) without a schema change, which is what makes "one account,
 * many ways in" cheap.
 */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // phone | email
    // Phone in E.164, email lowercased. Uniqueness is per kind.
    identifier: text("identifier").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // Only ever set for kind = 'email'. scrypt, encoded with its parameters.
    passwordHash: text("password_hash"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_identities_kind_identifier_key").on(t.kind, t.identifier),
    index("user_identities_user_idx").on(t.userId),
    check("user_identities_kind_valid", sql`${t.kind} in ('phone','email')`),
  ],
);

/**
 * Server-side sessions, not JWTs: a session that can move money has to be
 * revocable in one statement. Only the hash of the token is stored, so a
 * database leak does not hand over live sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Set when the user re-verified for a sensitive action (payout, payout account change).
    elevatedAt: timestamp("elevated_at", { withTimezone: true }),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * One-time codes for phone (and email) verification. The code itself is only
 * stored hashed; attempts and expiry are enforced in the database so a brute
 * force cannot be run by racing the application.
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
