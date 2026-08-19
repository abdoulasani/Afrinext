import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import { uuidv7 } from "../ids";
import { money } from "../money";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { cachedBalance, derivedBalance, platformAccount, resolveAccount, userAccount } from "./accounts";
import { recordCapture, recordProviderSettlement, settleSale } from "./flows";
import { post } from "./post";
import { reconcile, reconciliationIsClean } from "./reconcile";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

async function assertSound(): Promise<void> {
  const report = await reconcile(db);
  expect(report.unbalancedTransactions).toEqual([]);
  expect(report.drift).toEqual([]);
  for (const [currency, net] of report.systemNetByCurrency) {
    expect(`${currency}:${net}`).toBe(`${currency}:0`);
  }
  expect(reconciliationIsClean(report)).toBe(true);
}

/**
 * Phase 0 reasoned that the balance cache is safe under concurrency because
 * ON CONFLICT DO UPDATE takes a row lock. The review required that to be tested
 * rather than argued. These run real parallel transactions against PostgreSQL
 * through a connection pool.
 */
describe("concurrent posting", () => {
  it("does not lose an update when many transactions credit one account at once", async () => {
    const seller = await createTestUser(db);
    const CONCURRENCY = 40;
    const AMOUNT = 250n;

    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        post(db, {
          kind: "capture",
          idempotencyKey: `parallel-${i}-${uuidv7()}`,
          transfers: [
            {
              from: platformAccount("external_customer", "XOF"),
              to: userAccount("user_available", seller, "XOF"),
              amount: money(AMOUNT, "XOF"),
            },
          ],
        }),
      ),
    );

    const account = await resolveAccount(db, userAccount("user_available", seller, "XOF"));
    const expected = AMOUNT * BigInt(CONCURRENCY);

    // The whole point: a lost update would leave the cache short of the truth.
    expect(await derivedBalance(db, account.id)).toBe(expected);
    expect(await cachedBalance(db, account.id)).toBe(expected);
    await assertSound();
  });

  it("keeps the cache exact when concurrent transfers move in both directions", async () => {
    const user = await createTestUser(db);
    const pending = userAccount("user_pending", user, "XOF");
    const available = userAccount("user_available", user, "XOF");

    // Seed pending so the outbound half has something to move.
    await post(db, {
      kind: "capture",
      idempotencyKey: `seed-${uuidv7()}`,
      transfers: [
        { from: platformAccount("external_customer", "XOF"), to: pending, amount: money(100_000n, "XOF") },
      ],
    });

    const moves = Array.from({ length: 30 }, (_, i) =>
      post(db, {
        kind: "adjustment",
        idempotencyKey: `move-${i}-${uuidv7()}`,
        transfers:
          i % 2 === 0
            ? [{ from: pending, to: available, amount: money(1_000n, "XOF") }]
            : [{ from: available, to: pending, amount: money(400n, "XOF") }],
      }),
    );
    await Promise.all(moves);

    const pendingAccount = await resolveAccount(db, pending);
    const availableAccount = await resolveAccount(db, available);

    for (const id of [pendingAccount.id, availableAccount.id]) {
      expect(await cachedBalance(db, id)).toBe(await derivedBalance(db, id));
    }
    // 15 moves out at 1000, 15 back at 400.
    expect(await derivedBalance(db, availableAccount.id)).toBe(15n * 1_000n - 15n * 400n);
    await assertSound();
  });

  it("creates one account, not several, when it is first used concurrently", async () => {
    const user = await createTestUser(db);
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        post(db, {
          kind: "capture",
          idempotencyKey: `first-use-${i}-${uuidv7()}`,
          transfers: [
            {
              from: platformAccount("external_customer", "XOF"),
              to: userAccount("user_available", user, "XOF"),
              amount: money(10n, "XOF"),
            },
          ],
        }),
      ),
    );

    const rows = await db.execute<{ count: string | bigint }>(sql`
      select count(*)::bigint as count from ledger_accounts
       where kind = 'user_available' and owner_id = ${user}
    `);
    // The unique index must decide the winner; a duplicate account would split
    // the balance in two and neither half would be the seller's real entitlement.
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(1);
    await assertSound();
  });
});

describe("concurrent idempotent retries", () => {
  it("posts exactly once when the same key is submitted in parallel", async () => {
    const key = `retry-storm-${uuidv7()}`;
    const gross = money(9_000n, "XOF");

    // A client that retries on timeout can genuinely fire these at once.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => recordCapture(db, { gross, idempotencyKey: key })),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof recordCapture>>> =>
        r.status === "fulfilled",
    );
    expect(fulfilled.length, "every concurrent retry should resolve").toBe(12);

    const ids = new Set(fulfilled.map((r) => r.value.id));
    // All twelve must name the SAME transaction — an empty or differing id means
    // a caller cannot tell what happened to their money.
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(fulfilled.filter((r) => !r.value.replayed)).toHaveLength(1);

    const psp = await resolveAccount(db, platformAccount("psp_clearing", "XOF"));
    expect(await derivedBalance(db, psp.id)).toBe(9_000n);
    await assertSound();
  });

  it("settles a sale exactly once under a parallel retry storm", async () => {
    const seller = await createTestUser(db);
    const gross = money(10_000n, "XOF");
    await recordCapture(db, { gross, idempotencyKey: `c-${seller}` });
    await recordProviderSettlement(db, { gross, idempotencyKey: `p-${seller}` });

    const key = `settle-storm-${uuidv7()}`;
    await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        settleSale(db, {
          gross,
          sellerUserId: seller,
          platformRateBps: 1800,
          holdSellerFunds: false,
          idempotencyKey: key,
        }),
      ),
    );

    const available = await resolveAccount(db, userAccount("user_available", seller, "XOF"));
    const revenue = await resolveAccount(db, platformAccount("platform_revenue", "XOF"));
    // Settling twice would pay the seller twice out of one payment.
    expect(await derivedBalance(db, available.id)).toBe(8_200n);
    expect(await derivedBalance(db, revenue.id)).toBe(1_800n);
    await assertSound();
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
