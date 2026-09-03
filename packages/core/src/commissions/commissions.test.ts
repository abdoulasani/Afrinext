import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import { uuidv7 } from "../ids";
import { money } from "../money";
import { ensureReferenceData, resetData, testDb, expectRejection } from "../test/harness";
import { freezeSchedule, NoCommissionRuleError, readSchedule, resolveRule } from "./index";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

async function addRule(rule: {
  transactionType: string; rateBps?: number; fixedMinor?: bigint;
  countryCode?: string; categoryId?: string; storeId?: string;
  priority?: number; from?: string; to?: string;
}): Promise<string> {
  const id = uuidv7();
  await db.execute(sql`
    insert into commission_rules
      (id, transaction_type, country_code, category_id, store_id, rate_bps, fixed_minor,
       currency, priority, effective_from, effective_to)
    values (${id}, ${rule.transactionType}, ${rule.countryCode ?? null},
            ${rule.categoryId ?? null}::uuid, ${rule.storeId ?? null}::uuid,
            ${rule.rateBps ?? null}, ${rule.fixedMinor ?? null}, 'XOF',
            ${rule.priority ?? 0}, ${rule.from ?? "2026-01-01T00:00:00Z"},
            ${rule.to ?? null})
  `);
  return id;
}

describe("rule resolution", () => {
  it("refuses to settle when no rule is in force", async () => {
    await expect(resolveRule(db, { transactionType: "course" })).rejects.toThrow(NoCommissionRuleError);
  });

  it("prefers the more specific rule", async () => {
    await addRule({ transactionType: "course", rateBps: 1800 });
    const storeId = uuidv7();
    const specific = await addRule({ transactionType: "course", rateBps: 1000, storeId });

    // A negotiated rate for one seller must beat the global default.
    expect((await resolveRule(db, { transactionType: "course", storeId })).id).toBe(specific);
    expect((await resolveRule(db, { transactionType: "course" })).rateBps).toBe(1800);
  });

  it("ranks store over country over global", async () => {
    await addRule({ transactionType: "course", rateBps: 1800 });
    await addRule({ transactionType: "course", rateBps: 1500, countryCode: "NE" });
    const storeId = uuidv7();
    await addRule({ transactionType: "course", rateBps: 900, countryCode: "NE", storeId });

    expect((await resolveRule(db, { transactionType: "course", countryCode: "NE" })).rateBps).toBe(1500);
    expect((await resolveRule(db, { transactionType: "course", countryCode: "NE", storeId })).rateBps).toBe(900);
  });

  it("breaks a specificity tie on priority, deterministically", async () => {
    await addRule({ transactionType: "course", rateBps: 1800, priority: 1 });
    await addRule({ transactionType: "course", rateBps: 1200, priority: 5 });
    // Same inputs must always give the same answer, or a settlement cannot be
    // re-derived later.
    for (let i = 0; i < 5; i += 1) {
      expect((await resolveRule(db, { transactionType: "course" })).rateBps).toBe(1200);
    }
  });

  it("ignores rules outside their effective window", async () => {
    await addRule({ transactionType: "course", rateBps: 1000, from: "2020-01-01T00:00:00Z", to: "2021-01-01T00:00:00Z" });
    await expect(resolveRule(db, { transactionType: "course" })).rejects.toThrow(NoCommissionRuleError);
    // ...but applies at a date inside the window.
    const at = new Date("2020-06-01T00:00:00Z");
    expect((await resolveRule(db, { transactionType: "course", at })).rateBps).toBe(1000);
  });

  it("does not leak a rule across transaction types", async () => {
    await addRule({ transactionType: "digital", rateBps: 1800 });
    await expect(resolveRule(db, { transactionType: "course" })).rejects.toThrow(NoCommissionRuleError);
  });
});

describe("frozen fee schedules", () => {
  it("freezes the documented split", async () => {
    await addRule({ transactionType: "course", rateBps: 1800 });
    const frozen = await freezeSchedule(db, {
      subjectType: "settlement", subjectId: uuidv7(),
      gross: money(10_000n, "XOF"), transactionType: "course", referralRateBps: 1000,
    });
    expect(frozen.seller.amountMinor).toBe(8_200n);
    expect(frozen.platform.amountMinor).toBe(1_620n);
    expect(frozen.referral?.amountMinor).toBe(180n);
  });

  it("survives a rate change unchanged — the point of freezing", async () => {
    const subjectId = uuidv7();
    await addRule({ transactionType: "course", rateBps: 1800 });
    await freezeSchedule(db, {
      subjectType: "settlement", subjectId,
      gross: money(10_000n, "XOF"), transactionType: "course",
    });

    // The business raises its rate. History must not move.
    await db.execute(sql`update commission_rules set rate_bps = 2500`);

    const stored = await readSchedule(db, "settlement", subjectId);
    expect(stored?.lines.get("platform")?.amountMinor).toBe(1_800n);
    expect(stored?.lines.get("seller")?.amountMinor).toBe(8_200n);
  });

  it("refuses to rewrite a frozen line", async () => {
    await addRule({ transactionType: "course", rateBps: 1800 });
    await freezeSchedule(db, {
      subjectType: "settlement", subjectId: uuidv7(),
      gross: money(5_000n, "XOF"), transactionType: "course",
    });
    await expectRejection(db.execute(sql`update fee_lines set amount_minor = 1`), /append-only/i);
    await expectRejection(db.execute(sql`delete from fee_lines`), /append-only/i);
  });

  it("refuses a split whose lines do not total the gross", async () => {
    await addRule({ transactionType: "course", rateBps: 1800 });
    const scheduleId = uuidv7();
    // Write a schedule by hand with a deliberately short line set.
    await expectRejection(
      db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into fee_schedules (id, subject_type, subject_id, gross_minor, currency)
          values (${scheduleId}, 'settlement', ${uuidv7()}::uuid, 10000, 'XOF')
        `);
        await tx.execute(sql`
          insert into fee_lines (id, schedule_id, key, basis, amount_minor, currency)
          values (${uuidv7()}, ${scheduleId}, 'platform', 'gross', 1800, 'XOF')
        `);
      }),
      /lines total .* but gross is/i,
    );
  });

  it("records which rule produced the platform line", async () => {
    const ruleId = await addRule({ transactionType: "course", rateBps: 1800 });
    const subjectId = uuidv7();
    const frozen = await freezeSchedule(db, {
      subjectType: "settlement", subjectId,
      gross: money(7_000n, "XOF"), transactionType: "course",
    });
    expect(frozen.ruleId).toBe(ruleId);

    const rows = await db.execute<{ rule_id: string | null; key: string }>(sql`
      select l.rule_id, l.key from fee_lines l
        join fee_schedules s on s.id = l.schedule_id
       where s.subject_id = ${subjectId}::uuid
    `);
    const platform = rows.rows.find((r) => r.key === "platform");
    // "Why did I receive this amount?" has to be answerable back to a rule.
    expect(platform?.rule_id).toBe(ruleId);
  });

  it("supports a fixed fee as well as a rate", async () => {
    await addRule({ transactionType: "digital", fixedMinor: 250n });
    const frozen = await freezeSchedule(db, {
      subjectType: "settlement", subjectId: uuidv7(),
      gross: money(1_000n, "XOF"), transactionType: "digital",
    });
    expect(frozen.platform.amountMinor).toBe(250n);
    expect(frozen.seller.amountMinor).toBe(750n);
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
