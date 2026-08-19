import { sql } from "drizzle-orm";
import {
  bigint, char, check, index, jsonb, pgTable, smallint,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { currencies } from "./reference";

/**
 * Account kinds. Together these express the whole confirmed money model:
 * customer payment, provider clearing, platform revenue, seller entitlement,
 * pending vs available funds, referral commission, payout payable and payout
 * completed — plus refunds and reversals, which are ordinary transactions
 * posted in the opposite direction.
 *
 * The two external_* kinds are where value enters and leaves Afrinext. They
 * exist so that money arriving from a customer, or leaving to a beneficiary,
 * is still a balanced transaction rather than value appearing from nowhere.
 *
 * Note what these accounts are NOT: they are not a statement about where money
 * physically sits, or about custody. They record entitlement — who Afrinext
 * owes what — which is layer D/E of the architecture, not layer G.
 */
export const LEDGER_ACCOUNT_KINDS = [
  "external_customer",
  "psp_clearing",
  "platform_escrow",
  "platform_revenue",
  "user_pending",
  "user_available",
  "payout_payable",
  "external_payout",
] as const;

export type LedgerAccountKind = (typeof LEDGER_ACCOUNT_KINDS)[number];

const kindList = LEDGER_ACCOUNT_KINDS.map((k) => `'${k}'`).join(",");

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    // 'user' for a person's balances; NULL for platform-level accounts.
    ownerType: text("owner_type"),
    ownerId: uuid("owner_id"),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One account per (kind, owner, currency). COALESCE keeps NULL owners unique.
    uniqueIndex("ledger_accounts_identity_key").on(
      t.kind,
      sql`coalesce(${t.ownerType}, '')`,
      sql`coalesce(${t.ownerId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.currency,
    ),
    index("ledger_accounts_owner_idx").on(t.ownerType, t.ownerId),
    check("ledger_accounts_kind_valid", sql.raw(`kind in (${kindList})`)),
    check(
      "ledger_accounts_owner_consistent",
      sql`(${t.ownerType} is null and ${t.ownerId} is null) or (${t.ownerType} is not null and ${t.ownerId} is not null)`,
    ),
  ],
);

/**
 * A transaction groups entries that must balance. It is never updated: a
 * mistake is corrected by posting a compensating transaction that points back
 * through reversesId.
 */
export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(), // capture | settlement | refund | payout_approved | payout_settled | adjustment
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    // Replaying the same operation returns the original transaction rather than posting twice.
    idempotencyKey: text("idempotency_key"),
    reversesId: uuid("reverses_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_transactions_idempotency_key").on(t.idempotencyKey),
    index("ledger_transactions_occurred_idx").on(t.occurredAt),
    index("ledger_transactions_reverses_idx").on(t.reversesId),
  ],
);

/**
 * Immutable. UPDATE and DELETE are revoked from the application role in
 * migration 0001 — append-only is enforced by the database, not by discipline.
 *
 * direction is +1 or -1 and amountMinor is always positive, so an account's
 * balance is sum(direction * amount_minor) and a transaction balances when
 * that sum is zero across its entries, per currency.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id").notNull().references(() => ledgerTransactions.id),
    accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id),
    direction: smallint("direction").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_transaction_idx").on(t.transactionId),
    index("ledger_entries_account_idx").on(t.accountId),
    check("ledger_entries_direction_valid", sql`${t.direction} in (-1, 1)`),
    check("ledger_entries_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

/**
 * A cache, never the truth. Updated inside the same transaction as the entries
 * it summarises, and asserted against sum(entries) by the reconciliation job.
 */
export const accountBalances = pgTable("account_balances", {
  accountId: uuid("account_id").primaryKey().references(() => ledgerAccounts.id, { onDelete: "cascade" }),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull().default(sql`0`),
  entryCount: bigint("entry_count", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Idempotency for any operation that moves money. The stored request hash
 * makes a key reused with different inputs an error rather than a silent
 * replay of someone else's result.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    resultRef: uuid("result_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idempotency_scope_idx").on(t.scope)],
);
