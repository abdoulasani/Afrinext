import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@afrinext/db";
import { uuidv7 } from "../src/ids";
import { money } from "../src/money";
import {
  approvePayout, recordCapture, recordProviderSettlement, settlePayout, settleSale,
} from "../src/ledger/flows";
import { reconcile, reconciliationIsClean } from "../src/ledger/reconcile";

/**
 * CI gate: run one full economic cycle, then assert the books balance.
 *
 * The suite truncates between tests, so reconciling an empty ledger would
 * assert nothing. This posts a real capture → settlement → payout cycle first,
 * so every CI run proves the invariants on actual movements: every transaction
 * balances, the whole ledger nets to zero per currency, and every cached
 * balance equals the sum of its entries.
 */
async function main(): Promise<void> {
  const testUrl = process.env["TEST_DATABASE_URL"];
  if (testUrl !== undefined && testUrl !== "") process.env["DATABASE_URL"] = testUrl;

  const db = getDb();
  const run = uuidv7();
  const seller = uuidv7();
  const ambassador = uuidv7();

  // Ledger accounts reference a user only by id, but create the rows so the
  // scenario matches how the application actually posts.
  await db.execute(sql`
    insert into users (id, locale) values (${seller}, 'fr'), (${ambassador}, 'fr')
    on conflict do nothing
  `);

  const gross = money(10_000n, "XOF");
  await recordCapture(db, { gross, idempotencyKey: `ci-cap-${run}` });
  await recordProviderSettlement(db, { gross, idempotencyKey: `ci-psp-${run}` });
  const settlement = await settleSale(db, {
    gross,
    sellerUserId: seller,
    platformRateBps: 1800,
    referral: { ambassadorUserId: ambassador, rateBps: 1000 },
    holdSellerFunds: false,
    idempotencyKey: `ci-set-${run}`,
  });
  await approvePayout(db, {
    userId: seller,
    amount: settlement.sellerAmount,
    idempotencyKey: `ci-apr-${run}`,
    approvedBy: ambassador,
  });
  await settlePayout(db, {
    amount: settlement.sellerAmount,
    idempotencyKey: `ci-stl-${run}`,
  });

  const report = await reconcile(db);
  const summary = {
    scenario: {
      gross: gross.amountMinor.toString(),
      seller: settlement.sellerAmount.amountMinor.toString(),
      platform: settlement.platformAmount.amountMinor.toString(),
      referral: settlement.referralAmount?.amountMinor.toString() ?? null,
    },
    checkedAccounts: report.checkedAccounts,
    drift: report.drift.length,
    unbalancedTransactions: report.unbalancedTransactions.length,
    netByCurrency: Object.fromEntries(
      [...report.systemNetByCurrency].map(([c, n]) => [c, n.toString()]),
    ),
  };
  console.log(JSON.stringify(summary, null, 2));

  const splitSums =
    settlement.sellerAmount.amountMinor +
    settlement.platformAmount.amountMinor +
    (settlement.referralAmount?.amountMinor ?? 0n);

  await closeDb();

  if (splitSums !== gross.amountMinor) {
    console.error(`Split does not re-sum to gross: ${splitSums} vs ${gross.amountMinor}`);
    process.exit(1);
  }
  if (report.checkedAccounts === 0) {
    console.error("Reconciliation checked no accounts — the gate would be vacuous.");
    process.exit(1);
  }
  if (!reconciliationIsClean(report)) {
    console.error("Ledger reconciliation FAILED — the books do not balance.");
    process.exit(1);
  }
  console.log("Ledger reconciliation clean over a real capture → settlement → payout cycle.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
