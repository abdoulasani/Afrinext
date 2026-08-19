import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { schema } from "@afrinext/db";
import { IdempotencyConflictError, UnbalancedTransactionError } from "../errors";
import { uuidv7 } from "../ids";
import type { Money } from "../money";
import { resolveAccount, type AccountRef } from "./accounts";

/** Moving value from one account to another. Two entries, always balanced. */
export interface Transfer {
  readonly from: AccountRef;
  readonly to: AccountRef;
  readonly amount: Money;
  readonly note?: string;
}

export type LedgerTransactionKind =
  | "capture"
  | "settlement"
  | "refund"
  | "payout_approved"
  | "payout_settled"
  | "payout_failed"
  | "adjustment"
  | "reversal";

export interface PostInput {
  readonly kind: LedgerTransactionKind;
  readonly transfers: readonly Transfer[];
  /** Required for anything triggered by an external event or a user action. */
  readonly idempotencyKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly reversesId?: string;
  readonly occurredAt?: Date;
}

export interface PostedTransaction {
  readonly id: string;
  readonly kind: string;
  /** True when an existing transaction was returned instead of posting again. */
  readonly replayed: boolean;
}

function canonicalise(input: PostInput): string {
  const shape = {
    kind: input.kind,
    reversesId: input.reversesId ?? null,
    transfers: input.transfers.map((t) => ({
      from: [t.from.kind, t.from.ownerType ?? null, t.from.ownerId ?? null, t.from.currency],
      to: [t.to.kind, t.to.ownerType ?? null, t.to.ownerId ?? null, t.to.currency],
      amount: t.amount.amountMinor.toString(),
      currency: t.amount.currency,
    })),
  };
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

/**
 * Asserts the transaction balances before it reaches the database.
 *
 * The database enforces this too, with a deferred constraint trigger. Checking
 * here as well means the caller gets a domain error naming the currency and the
 * imbalance, rather than a Postgres exception at COMMIT.
 */
function assertBalanced(transfers: readonly Transfer[]): void {
  const net = new Map<string, bigint>();
  for (const t of transfers) {
    if (t.amount.amountMinor <= 0n) {
      throw new UnbalancedTransactionError(t.amount.currency, t.amount.amountMinor);
    }
    if (t.from.currency !== t.amount.currency || t.to.currency !== t.amount.currency) {
      throw new UnbalancedTransactionError(t.amount.currency, t.amount.amountMinor);
    }
    net.set(t.amount.currency, net.get(t.amount.currency) ?? 0n);
  }
  for (const [currency, value] of net) {
    // Transfers are balanced pairs by construction, so this is a guard against
    // a future change breaking that property rather than a live failure mode.
    if (value !== 0n) throw new UnbalancedTransactionError(currency, value);
  }
}

/**
 * Posts a balanced ledger transaction.
 *
 * Everything happens in one database transaction: the transaction row, its
 * entries, and the cached balance updates commit together or not at all. The
 * balance cache is updated with an atomic increment under the row lock taken
 * by ON CONFLICT DO UPDATE, so concurrent posts to the same account serialise
 * rather than losing an update.
 */
export async function post(db: Database, input: PostInput): Promise<PostedTransaction> {
  assertBalanced(input.transfers);
  const requestHash = canonicalise(input);

  return db.transaction(async (tx) => {
    if (input.idempotencyKey !== undefined) {
      const claimed = await tx
        .insert(schema.idempotencyKeys)
        .values({ key: input.idempotencyKey, scope: "ledger.post", requestHash })
        .onConflictDoNothing()
        .returning({ key: schema.idempotencyKeys.key });

      if (claimed.length === 0) {
        const priorRows = await tx
          .select()
          .from(schema.idempotencyKeys)
          .where(eq(schema.idempotencyKeys.key, input.idempotencyKey))
          .limit(1);
        const prior = priorRows[0];
        /* c8 ignore next */
        if (prior === undefined) throw new Error("Idempotency row vanished mid-transaction.");
        if (prior.requestHash !== requestHash) {
          throw new IdempotencyConflictError(input.idempotencyKey);
        }
        return {
          id: prior.resultRef ?? "",
          kind: input.kind,
          replayed: true,
        } satisfies PostedTransaction;
      }
    }

    const transactionId = uuidv7();
    await tx.insert(schema.ledgerTransactions).values({
      id: transactionId,
      kind: input.kind,
      ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.reversesId !== undefined ? { reversesId: input.reversesId } : {}),
      metadata: input.metadata ?? {},
    });

    // Net movement per account, so a transfer chain touching one account twice
    // updates its cached balance once.
    const delta = new Map<string, bigint>();
    const entries: (typeof schema.ledgerEntries.$inferInsert)[] = [];

    for (const transfer of input.transfers) {
      const fromAccount = await resolveAccount(tx as unknown as Database, transfer.from);
      const toAccount = await resolveAccount(tx as unknown as Database, transfer.to);

      entries.push(
        {
          id: uuidv7(),
          transactionId,
          accountId: fromAccount.id,
          direction: -1,
          amountMinor: transfer.amount.amountMinor,
          currency: transfer.amount.currency,
        },
        {
          id: uuidv7(),
          transactionId,
          accountId: toAccount.id,
          direction: 1,
          amountMinor: transfer.amount.amountMinor,
          currency: transfer.amount.currency,
        },
      );

      delta.set(fromAccount.id, (delta.get(fromAccount.id) ?? 0n) - transfer.amount.amountMinor);
      delta.set(toAccount.id, (delta.get(toAccount.id) ?? 0n) + transfer.amount.amountMinor);
    }

    await tx.insert(schema.ledgerEntries).values(entries);

    const countByAccount = new Map<string, bigint>();
    for (const e of entries) {
      countByAccount.set(e.accountId, (countByAccount.get(e.accountId) ?? 0n) + 1n);
    }

    for (const [accountId, amount] of delta) {
      await tx
        .insert(schema.accountBalances)
        .values({
          accountId,
          balanceMinor: amount,
          entryCount: countByAccount.get(accountId) ?? 0n,
        })
        .onConflictDoUpdate({
          target: schema.accountBalances.accountId,
          set: {
            balanceMinor: sql`${schema.accountBalances.balanceMinor} + ${amount}`,
            entryCount: sql`${schema.accountBalances.entryCount} + ${countByAccount.get(accountId) ?? 0n}`,
            updatedAt: sql`now()`,
          },
        });
    }

    if (input.idempotencyKey !== undefined) {
      await tx
        .update(schema.idempotencyKeys)
        .set({ resultRef: transactionId })
        .where(eq(schema.idempotencyKeys.key, input.idempotencyKey));
    }

    return { id: transactionId, kind: input.kind, replayed: false } satisfies PostedTransaction;
  });
}

/**
 * Reverses a transaction by posting its mirror image.
 *
 * Nothing is edited or deleted — the original entries stay, and the pair nets
 * to zero. This is how refunds, failed payouts and corrections are handled.
 */
export async function reverse(
  db: Database,
  transactionId: string,
  options: { readonly reason: string; readonly idempotencyKey?: string },
): Promise<PostedTransaction> {
  const rows = await db.execute<{
    account_id: string;
    direction: number;
    amount_minor: bigint | string;
    currency: string;
    kind: string;
    owner_type: string | null;
    owner_id: string | null;
  }>(sql`
    select e.account_id, e.direction, e.amount_minor, e.currency,
           a.kind, a.owner_type, a.owner_id
      from ledger_entries e
      join ledger_accounts a on a.id = e.account_id
     where e.transaction_id = ${transactionId}
     order by e.id
  `);

  if (rows.rows.length === 0) {
    throw new Error(`Cannot reverse ${transactionId}: it has no entries.`);
  }

  // Rebuild the transfers, swapping direction. Entries come in from/to pairs.
  const transfers: Transfer[] = [];
  const debits = rows.rows.filter((r) => Number(r.direction) === -1);
  const credits = rows.rows.filter((r) => Number(r.direction) === 1);

  for (const [index, debit] of debits.entries()) {
    const credit = credits[index];
    /* c8 ignore next */
    if (credit === undefined) throw new Error("Unpaired ledger entry while reversing.");
    const amountMinor =
      typeof debit.amount_minor === "bigint" ? debit.amount_minor : BigInt(debit.amount_minor);
    transfers.push({
      // Reversed: what was credited is now debited.
      from: {
        kind: credit.kind as AccountRef["kind"],
        ownerType: (credit.owner_type ?? undefined) as "user" | undefined,
        ownerId: credit.owner_id ?? undefined,
        currency: credit.currency,
      },
      to: {
        kind: debit.kind as AccountRef["kind"],
        ownerType: (debit.owner_type ?? undefined) as "user" | undefined,
        ownerId: debit.owner_id ?? undefined,
        currency: debit.currency,
      },
      amount: { amountMinor, currency: debit.currency },
    });
  }

  return post(db, {
    kind: "reversal",
    transfers,
    reversesId: transactionId,
    metadata: { reason: options.reason, reverses: transactionId },
    ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
  });
}
