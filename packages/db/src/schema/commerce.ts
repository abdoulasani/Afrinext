import { sql } from "drizzle-orm";
import {
  bigint, char, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { currencies } from "./reference";
import { ledgerTransactions } from "./ledger";
import { products, stores } from "./catalog";
import { users } from "./identity";

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

// ---------------------------------------------------------------------------
// Checkout: orders, payments and what a confirmed payment grants
// ---------------------------------------------------------------------------

/**
 * A buyer's intent to purchase, priced by the server.
 *
 * `total_minor` is not a number the client sent. It is recomputed from the
 * product rows at creation and then frozen here, so a price edit tomorrow
 * cannot restate what was agreed today — the same reasoning the frozen fee
 * snapshot uses one layer down.
 *
 * `checkout_key` is the buyer's idempotency key. Unique per buyer, so a double
 * submit — a slow network, an impatient tap, a retried fetch — resolves to the
 * order that already exists rather than a second one.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    buyerUserId: uuid("buyer_user_id").notNull().references(() => users.id),
    storeId: uuid("store_id").notNull().references(() => stores.id),
    checkoutKey: text("checkout_key").notNull(),
    /** pending_payment | paid | failed | cancelled | expired | refund_due */
    status: text("status").notNull().default("pending_payment"),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /**
     * Set when a verified payment arrived AFTER expiry, whichever way it was
     * then decided. The audit log holds the reasoning; this column is what
     * makes the case countable without reading it.
     */
    latePaymentAt: timestamp("late_payment_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_buyer_checkout_key").on(t.buyerUserId, t.checkoutKey),
    index("orders_buyer_idx").on(t.buyerUserId, t.createdAt),
    index("orders_store_idx").on(t.storeId, t.createdAt),
    index("orders_open_idx").on(t.status, t.expiresAt),
    check(
      "orders_status_valid",
      sql`${t.status} in ('pending_payment','paid','failed','cancelled','expired','refund_due')`,
    ),
    check(
      "orders_late_payment_after_expiry",
      sql`${t.latePaymentAt} is null or ${t.latePaymentAt} >= ${t.expiresAt}`,
    ),
    check("orders_total_positive", sql`${t.totalMinor} > 0`),
    // A paid order knows when it was paid; an unpaid one must not claim to.
    check(
      "orders_paid_has_timestamp",
      sql`(${t.status} <> 'paid') or (${t.paidAt} is not null)`,
    ),
  ],
);

/**
 * The lines of an order, with the product's title and price copied in.
 *
 * Snapshots rather than joins. A join would show today's price on a receipt
 * for last month's sale, and the seller could change it. One row per product
 * today — quantity exists so a basket is a shape change here rather than a new
 * table later.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    storeId: uuid("store_id").notNull().references(() => stores.id),
    titleSnapshot: text("title_snapshot").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    quantity: integer("quantity").notNull().default(1),
    lineTotalMinor: bigint("line_total_minor", { mode: "bigint" }).notNull(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    // One line per product per order: a second tap adds quantity, never a
    // duplicate line that a total could double-count.
    uniqueIndex("order_items_order_product_key").on(t.orderId, t.productId),
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
    check("order_items_price_positive", sql`${t.unitPriceMinor} > 0`),
    // The line total is arithmetic, not an independent field a caller may set.
    check("order_items_line_total_consistent", sql`${t.lineTotalMinor} = ${t.unitPriceMinor} * ${t.quantity}`),
  ],
);

/**
 * One attempt to pay for an order through a provider.
 *
 * The amount is copied from the order, so a webhook claiming a different figure
 * has something to disagree with. `provider_ref` is what the provider calls the
 * charge and is how an inbound event finds its way back to an order — never the
 * order id, which a caller could guess.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    /** initiated | pending | succeeded | failed | cancelled | expired */
    status: text("status").notNull().default("initiated"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    idempotencyKey: text("idempotency_key").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_idempotency_key").on(t.idempotencyKey),
    uniqueIndex("payments_provider_ref_key").on(t.provider, t.providerRef),
    index("payments_order_idx").on(t.orderId),
    check(
      "payments_status_valid",
      sql`${t.status} in ('initiated','pending','succeeded','failed','cancelled','expired')`,
    ),
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "payments_succeeded_has_timestamp",
      sql`(${t.status} <> 'succeeded') or (${t.confirmedAt} is not null)`,
    ),
  ],
);

/**
 * Every provider event we have accepted or refused, kept forever.
 *
 * `provider_event_id` is UNIQUE, which is what makes a replayed webhook a
 * no-op at the database rather than a race in application code. Refused events
 * are stored too: an attacker probing the endpoint with a forged amount leaves
 * a record, and a genuine provider bug leaves evidence.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey(),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    providerRef: text("provider_ref").notNull(),
    type: text("type").notNull(),
    reportedStatus: text("reported_status").notNull(),
    /** applied | ignored | rejected */
    outcome: text("outcome").notNull(),
    /** Why, when it was not applied. Never shown to the caller. */
    reason: text("reason"),
    payload: text("payload").notNull(),
    /**
     * charge | refund. A refund webhook is not a second, weaker door: it goes
     * through this table and the same UNIQUE (provider, provider_event_id)
     * replay index that charges do.
     */
    subject: text("subject").notNull().default("charge"),
    /**
     * The refund a refund event belongs to. Declared without a Drizzle-level
     * reference because `refunds` imports this file; the foreign key itself is
     * real and lives in migration 0012.
     */
    refundId: uuid("refund_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_events_provider_event_key").on(t.provider, t.providerEventId),
    index("payment_events_payment_idx").on(t.paymentId, t.receivedAt),
    check("payment_events_outcome_valid", sql`${t.outcome} in ('applied','ignored','rejected')`),
    check("payment_events_subject_valid", sql`${t.subject} in ('charge','refund')`),
  ],
);

/**
 * What a confirmed payment grants.
 *
 * Created only inside the transaction that marks an order paid, and unique per
 * buyer and product — so a replayed confirmation, a concurrent one, or a second
 * order for the same product cannot produce two grants. Access is read from
 * here; it is never inferred from an order's status at read time.
 */
export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    source: text("source").notNull().default("purchase"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set, never deleted — the grant happened, and the record of it is part of
     * why someone had access last month. Access reads `revoked_at is null`, so
     * revoking is one statement and takes effect on the next request rather
     * than on the next login.
     *
     * Nothing in this milestone revokes: that is a refund decision, and refunds
     * are out of scope. The column exists so "a revoked entitlement grants
     * nothing" is a property the access path can be tested against today.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("entitlements_user_product_key").on(t.userId, t.productId),
    index("entitlements_user_idx").on(t.userId, t.grantedAt),
    check("entitlements_source_valid", sql`${t.source} in ('purchase','grant')`),
  ],
);
