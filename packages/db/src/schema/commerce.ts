import { sql } from "drizzle-orm";
import {
  bigint, char, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { currencies } from "./reference";
import { ledgerTransactions } from "./ledger";

/**
 * Commission rules are data, resolved at the moment of sale and then frozen.
 *
 * A rule is never read again to explain a past settlement — the frozen fee
 * lines are. That is what lets Afrinext change its rate next quarter without
 * rewriting what a seller was told they earned last quarter.
 */
export const commissionRules = pgTable(
  "commission_rules",
  {
    id: uuid("id").primaryKey(),
    transactionType: text("transaction_type").notNull(),
    // NULL means "any". More non-null scopes = more specific = wins.
    countryCode: char("country_code", { length: 2 }),
    categoryId: uuid("category_id"),
    storeId: uuid("store_id"),
    rateBps: integer("rate_bps"),
    fixedMinor: bigint("fixed_minor", { mode: "bigint" }),
    currency: char("currency", { length: 3 }).references(() => currencies.code),
    priority: integer("priority").notNull().default(0),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("commission_rules_lookup_idx").on(t.transactionType, t.effectiveFrom),
    check("commission_rules_rate_sane", sql`${t.rateBps} is null or (${t.rateBps} >= 0 and ${t.rateBps} <= 10000)`),
    check("commission_rules_has_a_charge", sql`${t.rateBps} is not null or ${t.fixedMinor} is not null`),
    check("commission_rules_window_ordered", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

/**
 * The frozen outcome of resolving the rules for one sale.
 *
 * Append-only, like the ledger: this is the evidence behind "why did I receive
 * this amount?", and evidence that can be edited is not evidence.
 */
export const feeSchedules = pgTable(
  "fee_schedules",
  {
    id: uuid("id").primaryKey(),
    subjectType: text("subject_type").notNull(), // 'settlement' now, 'order' once orders exist
    subjectId: uuid("subject_id").notNull(),
    grossMinor: bigint("gross_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fee_schedules_subject_key").on(t.subjectType, t.subjectId),
    check("fee_schedules_gross_non_negative", sql`${t.grossMinor} >= 0`),
  ],
);

export const feeLines = pgTable(
  "fee_lines",
  {
    id: uuid("id").primaryKey(),
    scheduleId: uuid("schedule_id").notNull().references(() => feeSchedules.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // platform | referral | seller
    // Which rule produced this line. Null for the residual, which is arithmetic.
    ruleId: uuid("rule_id").references(() => commissionRules.id),
    basis: text("basis").notNull(), // 'gross' | 'line:platform' | 'residual'
    rateBps: integer("rate_bps"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
  },
  (t) => [
    uniqueIndex("fee_lines_schedule_key").on(t.scheduleId, t.key),
    check("fee_lines_amount_non_negative", sql`${t.amountMinor} >= 0`),
  ],
);

/**
 * Settlement state: when money stops being pending and becomes withdrawable.
 *
 * A dispute does not get its own status — it pushes `releaseAt` forward, so
 * disputed money simply never reaches an available balance while it is open.
 */
export const settlementHolds = pgTable(
  "settlement_holds",
  {
    id: uuid("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    userId: uuid("user_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedByTransactionId: uuid("released_by_transaction_id").references(() => ledgerTransactions.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("settlement_holds_subject_key").on(t.subjectType, t.subjectId, t.userId),
    index("settlement_holds_due_idx").on(t.releaseAt),
    check("settlement_holds_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);
