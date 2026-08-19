import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { schema } from "@afrinext/db";
import type { LedgerAccountKind } from "@afrinext/db";
import { uuidv7 } from "../ids";

export interface AccountRef {
  readonly kind: LedgerAccountKind;
  readonly ownerType?: "user" | undefined;
  readonly ownerId?: string | undefined;
  readonly currency: string;
}

export interface LedgerAccount {
  readonly id: string;
  readonly kind: string;
  readonly ownerType: string | null;
  readonly ownerId: string | null;
  readonly currency: string;
}

/** Platform-level accounts have no owner; user balances do. */
export function platformAccount(kind: LedgerAccountKind, currency: string): AccountRef {
  return { kind, currency };
}

export function userAccount(
  kind: Extract<LedgerAccountKind, "user_pending" | "user_available">,
  userId: string,
  currency: string,
): AccountRef {
  return { kind, ownerType: "user", ownerId: userId, currency };
}

/**
 * Resolves an account, creating it on first use.
 *
 * Accounts are created lazily because the alternative — pre-creating every
 * (kind × user × currency) combination — is a large table of empty rows and a
 * migration every time a currency is added.
 */
export async function resolveAccount(db: Database, ref: AccountRef): Promise<LedgerAccount> {
  const ownerType = ref.ownerType ?? null;
  const ownerId = ref.ownerId ?? null;

  const where = and(
    eq(schema.ledgerAccounts.kind, ref.kind),
    eq(schema.ledgerAccounts.currency, ref.currency),
    ownerType === null
      ? isNull(schema.ledgerAccounts.ownerType)
      : eq(schema.ledgerAccounts.ownerType, ownerType),
    ownerId === null
      ? isNull(schema.ledgerAccounts.ownerId)
      : eq(schema.ledgerAccounts.ownerId, ownerId),
  );

  const existing = await db.select().from(schema.ledgerAccounts).where(where).limit(1);
  const found = existing[0];
  if (found !== undefined) return found as LedgerAccount;

  const id = uuidv7();
  // Concurrent first use of the same account is expected; the unique index
  // decides the winner and we re-read rather than failing the caller.
  await db
    .insert(schema.ledgerAccounts)
    .values({ id, kind: ref.kind, ownerType, ownerId, currency: ref.currency })
    .onConflictDoNothing();

  const settled = await db.select().from(schema.ledgerAccounts).where(where).limit(1);
  const account = settled[0];
  /* c8 ignore next */
  if (account === undefined) throw new Error("Account vanished immediately after creation.");

  await db
    .insert(schema.accountBalances)
    .values({ accountId: account.id, balanceMinor: 0n, entryCount: 0n })
    .onConflictDoNothing();

  return account as LedgerAccount;
}

/** The authoritative balance, computed from entries rather than the cache. */
export async function derivedBalance(db: Database, accountId: string): Promise<bigint> {
  const rows = await db.execute<{ balance_minor: string | bigint }>(sql`
    select coalesce(sum(direction::bigint * amount_minor), 0)::bigint as balance_minor
      from ledger_entries where account_id = ${accountId}
  `);
  const raw = rows.rows[0]?.balance_minor ?? 0n;
  return typeof raw === "bigint" ? raw : BigInt(raw);
}

/** The cached balance. Fast, and reconciled against the derived value nightly. */
export async function cachedBalance(db: Database, accountId: string): Promise<bigint> {
  const rows = await db
    .select({ balanceMinor: schema.accountBalances.balanceMinor })
    .from(schema.accountBalances)
    .where(eq(schema.accountBalances.accountId, accountId))
    .limit(1);
  return rows[0]?.balanceMinor ?? 0n;
}
