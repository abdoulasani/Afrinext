import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { closeDb, type Database } from "@afrinext/db";
import { IdempotencyConflictError } from "../errors";
import { uuidv7 } from "../ids";
import { money } from "../money";
import { createTestUser, ensureReferenceData, resetData, testDb, expectRejection } from "../test/harness";
import { cachedBalance, derivedBalance, platformAccount, resolveAccount, userAccount } from "./accounts";
import {
  approvePayout, failPayout, recordCapture, recordProviderSettlement,
  releaseHold, settlePayout, settleSale,
} from "./flows";
import { reverse } from "./post";
import { reconcile, reconciliationIsClean } from "./reconcile";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

/** The invariants that must hold after every operation, without exception. */
async function assertLedgerSound(database: Database): Promise<void> {
  const report = await reconcile(database);
  expect(report.unbalancedTransactions).toEqual([]);
  for (const [currency, net] of report.systemNetByCurrency) {
    expect(`${currency}:${net}`).toBe(`${currency}:0`);
  }
  expect(report.drift).toEqual([]);
  expect(reconciliationIsClean(report)).toBe(true);
}

describe("ledger invariants enforced by the database", () => {
  it("rejects an unbalanced transaction at COMMIT", async () => {
    const account = await resolveAccount(db, platformAccount("platform_escrow", "XOF"));
    const txId = uuidv7();

    await expectRejection(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into ledger_transactions (id, kind) values (${txId}, 'adjustment')`);
        // Two entries in the same direction: this creates money from nowhere.
        await tx.execute(sql`
          insert into ledger_entries (id, transaction_id, account_id, direction, amount_minor, currency)
          values (${uuidv7()}, ${txId}, ${account.id}, 1, 500, 'XOF'),
                 (${uuidv7()}, ${txId}, ${account.id}, 1, 500, 'XOF')
        `);
      }),
      /does not balance/i,
    );

    await assertLedgerSound(db);
  });

  // A lone entry always has a non-zero net, so the balance rule catches it
  // before the entry-count rule can. The count rule stays as defence in depth
  // in case a future migration ever relaxes the amount > 0 constraint.
  it("rejects a transaction with a single entry", async () => {
    const account = await resolveAccount(db, platformAccount("platform_escrow", "XOF"));
    const txId = uuidv7();
    await expectRejection(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into ledger_transactions (id, kind) values (${txId}, 'adjustment')`);
        await tx.execute(sql`
          insert into ledger_entries (id, transaction_id, account_id, direction, amount_minor, currency)
          values (${uuidv7()}, ${txId}, ${account.id}, 1, 500, 'XOF')
        `);
      }),
      /does not balance|fewer than two entries/i,
    );
  });

  it("rejects an entry whose currency differs from its account", async () => {
    const account = await resolveAccount(db, platformAccount("platform_escrow", "XOF"));
    const txId = uuidv7();
    await expectRejection(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into ledger_transactions (id, kind) values (${txId}, 'adjustment')`);
        await tx.execute(sql`
          insert into ledger_entries (id, transaction_id, account_id, direction, amount_minor, currency)
          values (${uuidv7()}, ${txId}, ${account.id}, 1, 500, 'NGN')
        `);
      }),
      /does not match account/i,
    );
  });

  it("refuses UPDATE and DELETE on ledger entries", async () => {
    const user = await createTestUser(db);
    await recordCapture(db, { gross: money(1000n, "XOF"), idempotencyKey: `cap-${user}` });

    await expectRejection(db.execute(sql`update ledger_entries set amount_minor = 1`), /append-only/i);
    await expectRejection(db.execute(sql`delete from ledger_entries`), /append-only/i);
    await expectRejection(db.execute(sql`delete from ledger_transactions`), /append-only/i);
  });

  it("refuses a non-positive amount", async () => {
    const account = await resolveAccount(db, platformAccount("platform_escrow", "XOF"));
    const txId = uuidv7();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into ledger_transactions (id, kind) values (${txId}, 'adjustment')`);
        await tx.execute(sql`
          insert into ledger_entries (id, transaction_id, account_id, direction, amount_minor, currency)
          values (${uuidv7()}, ${txId}, ${account.id}, 1, 0, 'XOF')
        `);
      }),
    ).rejects.toThrow();
  });
});

describe("idempotency", () => {
  it("replays rather than posting twice", async () => {
    const key = `capture-${uuidv7()}`;
    const first = await recordCapture(db, { gross: money(10_000n, "XOF"), idempotencyKey: key });
    const second = await recordCapture(db, { gross: money(10_000n, "XOF"), idempotencyKey: key });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.id).toBe(first.id);

    const psp = await resolveAccount(db, platformAccount("psp_clearing", "XOF"));
    expect(await derivedBalance(db, psp.id)).toBe(10_000n);
    await assertLedgerSound(db);
  });

  it("refuses a key reused with different inputs", async () => {
    const key = `capture-${uuidv7()}`;
    await recordCapture(db, { gross: money(10_000n, "XOF"), idempotencyKey: key });
    await expect(
      recordCapture(db, { gross: money(20_000n, "XOF"), idempotencyKey: key }),
    ).rejects.toThrow(IdempotencyConflictError);
    await assertLedgerSound(db);
  });
});

describe("the confirmed economic cycle", () => {
  it("runs customer payment through to payout, and every stage balances", async () => {
    const seller = await createTestUser(db);
    const ambassador = await createTestUser(db);
    const gross = money(10_000n, "XOF");

    await recordCapture(db, { gross, idempotencyKey: `cap-${seller}` });
    await recordProviderSettlement(db, { gross, idempotencyKey: `psp-${seller}` });

    const settlement = await settleSale(db, {
      gross,
      sellerUserId: seller,
      platformRateBps: 1800,
      referral: { ambassadorUserId: ambassador, rateBps: 1000 },
      holdSellerFunds: false,
      idempotencyKey: `settle-${seller}`,
    });

    // The documented split: seller 8 200, platform 1 620, ambassador 180.
    expect(settlement.sellerAmount.amountMinor).toBe(8_200n);
    expect(settlement.platformAmount.amountMinor).toBe(1_620n);
    expect(settlement.referralAmount?.amountMinor).toBe(180n);

    const sellerAvailable = await resolveAccount(db, userAccount("user_available", seller, "XOF"));
    const revenue = await resolveAccount(db, platformAccount("platform_revenue", "XOF"));
    const ambassadorPending = await resolveAccount(db, userAccount("user_pending", ambassador, "XOF"));
    const escrow = await resolveAccount(db, platformAccount("platform_escrow", "XOF"));

    expect(await derivedBalance(db, sellerAvailable.id)).toBe(8_200n);
    expect(await derivedBalance(db, revenue.id)).toBe(1_620n);
    expect(await derivedBalance(db, ambassadorPending.id)).toBe(180n);
    expect(await derivedBalance(db, escrow.id)).toBe(0n);

    // Payout: approved funds leave the withdrawable balance immediately.
    await approvePayout(db, {
      userId: seller,
      amount: money(8_200n, "XOF"),
      idempotencyKey: `payout-approve-${seller}`,
      approvedBy: ambassador,
    });
    expect(await derivedBalance(db, sellerAvailable.id)).toBe(0n);

    await settlePayout(db, {
      amount: money(8_200n, "XOF"),
      idempotencyKey: `payout-settle-${seller}`,
      providerRef: "mockpay_1",
    });

    const payable = await resolveAccount(db, platformAccount("payout_payable", "XOF"));
    const paidOut = await resolveAccount(db, platformAccount("external_payout", "XOF"));
    expect(await derivedBalance(db, payable.id)).toBe(0n);
    expect(await derivedBalance(db, paidOut.id)).toBe(8_200n);

    await assertLedgerSound(db);
  });

  it("returns funds to the user when a payout fails — money never disappears", async () => {
    const seller = await createTestUser(db);
    const gross = money(5_000n, "XOF");
    await recordCapture(db, { gross, idempotencyKey: `c-${seller}` });
    await recordProviderSettlement(db, { gross, idempotencyKey: `p-${seller}` });
    await settleSale(db, {
      gross, sellerUserId: seller, platformRateBps: 1000,
      holdSellerFunds: false, idempotencyKey: `s-${seller}`,
    });

    const available = await resolveAccount(db, userAccount("user_available", seller, "XOF"));
    const before = await derivedBalance(db, available.id);

    await approvePayout(db, {
      userId: seller, amount: money(before, "XOF"),
      idempotencyKey: `a-${seller}`, approvedBy: uuidv7(),
    });
    expect(await derivedBalance(db, available.id)).toBe(0n);

    await failPayout(db, {
      userId: seller, amount: money(before, "XOF"),
      idempotencyKey: `f-${seller}`, reason: "beneficiary account rejected",
    });
    expect(await derivedBalance(db, available.id)).toBe(before);
    await assertLedgerSound(db);
  });

  it("holds seller funds when the sale still has a refund window", async () => {
    const seller = await createTestUser(db);
    const gross = money(7_000n, "XOF");
    await recordCapture(db, { gross, idempotencyKey: `c-${seller}` });
    await recordProviderSettlement(db, { gross, idempotencyKey: `p-${seller}` });
    const result = await settleSale(db, {
      gross, sellerUserId: seller, platformRateBps: 1800,
      holdSellerFunds: true, idempotencyKey: `s-${seller}`,
    });

    const pending = await resolveAccount(db, userAccount("user_pending", seller, "XOF"));
    const available = await resolveAccount(db, userAccount("user_available", seller, "XOF"));
    expect(await derivedBalance(db, pending.id)).toBe(result.sellerAmount.amountMinor);
    expect(await derivedBalance(db, available.id)).toBe(0n);

    await releaseHold(db, {
      userId: seller, amount: result.sellerAmount, idempotencyKey: `r-${seller}`,
    });
    expect(await derivedBalance(db, pending.id)).toBe(0n);
    expect(await derivedBalance(db, available.id)).toBe(result.sellerAmount.amountMinor);
    await assertLedgerSound(db);
  });
});

describe("reversal", () => {
  it("restores every balance it touched, without editing history", async () => {
    const seller = await createTestUser(db);
    const gross = money(9_999n, "XOF");
    await recordCapture(db, { gross, idempotencyKey: `c-${seller}` });
    await recordProviderSettlement(db, { gross, idempotencyKey: `p-${seller}` });
    const settlement = await settleSale(db, {
      gross, sellerUserId: seller, platformRateBps: 1750,
      holdSellerFunds: false, idempotencyKey: `s-${seller}`,
    });

    const available = await resolveAccount(db, userAccount("user_available", seller, "XOF"));
    const revenue = await resolveAccount(db, platformAccount("platform_revenue", "XOF"));
    expect(await derivedBalance(db, available.id)).toBe(settlement.sellerAmount.amountMinor);

    await reverse(db, settlement.id, { reason: "refund", idempotencyKey: `rev-${seller}` });

    expect(await derivedBalance(db, available.id)).toBe(0n);
    expect(await derivedBalance(db, revenue.id)).toBe(0n);

    // History is intact: the original entries still exist alongside the mirror.
    const rows = await db.execute<{ count: string | bigint }>(
      sql`select count(*)::bigint as count from ledger_entries where transaction_id = ${settlement.id}`,
    );
    expect(Number(rows.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    await assertLedgerSound(db);
  });
});

describe("reconciliation", () => {
  it("detects drift injected into the balance cache", async () => {
    const seller = await createTestUser(db);
    await recordCapture(db, { gross: money(4_000n, "XOF"), idempotencyKey: `c-${seller}` });

    const psp = await resolveAccount(db, platformAccount("psp_clearing", "XOF"));
    expect(await cachedBalance(db, psp.id)).toBe(await derivedBalance(db, psp.id));

    // Corrupt the cache the way a posting bug would.
    await db.execute(
      sql`update account_balances set balance_minor = balance_minor + 7 where account_id = ${psp.id}`,
    );

    const report = await reconcile(db);
    expect(report.drift).toHaveLength(1);
    expect(report.drift[0]?.accountId).toBe(psp.id);
    expect(report.drift[0]?.differenceMinor).toBe(-7n);
    expect(reconciliationIsClean(report)).toBe(false);
  });
});

describe("property: randomised operation sequences", () => {
  it("keeps every invariant across arbitrary sequences of money movements", async () => {
    const operation = fc.record({
      kind: fc.constantFrom("capture", "settle", "release", "payout", "reverse_last"),
      grossMinor: fc.bigInt({ min: 1n, max: 10n ** 9n }),
      platformBps: fc.integer({ min: 0, max: 5000 }),
      referralBps: fc.integer({ min: 0, max: 10_000 }),
      withReferral: fc.boolean(),
      hold: fc.boolean(),
      sellerIndex: fc.integer({ min: 0, max: 2 }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(operation, { minLength: 4, maxLength: 14 }), async (operations) => {
        await resetData(db);
        const users = [await createTestUser(db), await createTestUser(db), await createTestUser(db)];
        const ambassador = await createTestUser(db);
        let lastSettlementId: string | undefined;
        const escrowed: bigint[] = [];

        for (const [index, op] of operations.entries()) {
          const seller = users[op.sellerIndex % users.length] as string;
          const gross = money(op.grossMinor, "XOF");
          const key = `${index}-${op.kind}-${uuidv7()}`;

          try {
            switch (op.kind) {
              case "capture": {
                await recordCapture(db, { gross, idempotencyKey: `cap-${key}` });
                await recordProviderSettlement(db, { gross, idempotencyKey: `psp-${key}` });
                escrowed.push(op.grossMinor);
                break;
              }
              case "settle": {
                const amount = escrowed.pop();
                if (amount === undefined) break;
                const result = await settleSale(db, {
                  gross: money(amount, "XOF"),
                  sellerUserId: seller,
                  platformRateBps: op.platformBps,
                  ...(op.withReferral
                    ? { referral: { ambassadorUserId: ambassador, rateBps: op.referralBps } }
                    : {}),
                  holdSellerFunds: op.hold,
                  idempotencyKey: `set-${key}`,
                });
                lastSettlementId = result.id;
                break;
              }
              case "release": {
                const pending = await resolveAccount(db, userAccount("user_pending", seller, "XOF"));
                const balance = await derivedBalance(db, pending.id);
                if (balance > 0n) {
                  await releaseHold(db, {
                    userId: seller, amount: money(balance, "XOF"), idempotencyKey: `rel-${key}`,
                  });
                }
                break;
              }
              case "payout": {
                const available = await resolveAccount(db, userAccount("user_available", seller, "XOF"));
                const balance = await derivedBalance(db, available.id);
                if (balance > 0n) {
                  await approvePayout(db, {
                    userId: seller, amount: money(balance, "XOF"),
                    idempotencyKey: `apr-${key}`, approvedBy: ambassador,
                  });
                  await settlePayout(db, {
                    amount: money(balance, "XOF"), idempotencyKey: `stl-${key}`,
                  });
                }
                break;
              }
              case "reverse_last": {
                if (lastSettlementId !== undefined) {
                  await reverse(db, lastSettlementId, { reason: "test", idempotencyKey: `rev-${key}` });
                  lastSettlementId = undefined;
                }
                break;
              }
            }
          } catch (error) {
            // A refused operation is fine; a broken invariant is not. Anything
            // that is not a deliberate domain refusal should fail the property.
            if (!(error instanceof Error)) throw error;
            if (!/balance|insufficient|exceeds|does not/i.test(error.message)) throw error;
          }

          await assertLedgerSound(db);
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
