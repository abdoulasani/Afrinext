import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { schema } from "@afrinext/db";
import { DomainError } from "../errors";
import { uuidv7 } from "../ids";
import { allocate, amountOf, money, type Money, type SplitLine } from "../money";

export class NoCommissionRuleError extends DomainError {
  override readonly name = "NoCommissionRuleError";
  constructor(transactionType: string) {
    super(
      "commission.no_rule",
      `No commission rule is in force for "${transactionType}". A sale cannot be ` +
        "settled without one, because there would be no defensible answer to " +
        "what the platform charged.",
    );
  }
}

export interface RuleQuery {
  readonly transactionType: string;
  readonly countryCode?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly storeId?: string | undefined;
  readonly at?: Date | undefined;
}

export interface ResolvedRule {
  readonly id: string;
  readonly rateBps: number | null;
  readonly fixedMinor: bigint | null;
  readonly priority: number;
  readonly specificity: number;
}

/**
 * Resolves which commission rule applies.
 *
 * Most specific wins: a rule naming a store beats one naming only a country,
 * which beats the global default. Ties break on `priority`, then on the most
 * recently effective rule — deterministic, so the same inputs always produce
 * the same answer and a settlement can be re-derived years later.
 */
export async function resolveRule(db: Database, query: RuleQuery): Promise<ResolvedRule> {
  const at = (query.at ?? new Date()).toISOString();
  const rows = await db.execute<{
    id: string; rate_bps: number | null; fixed_minor: bigint | string | null;
    priority: number; specificity: number;
  }>(sql`
    select id, rate_bps, fixed_minor, priority,
           (case when country_code is not null then 1 else 0 end)
         + (case when category_id  is not null then 1 else 0 end)
         + (case when store_id     is not null then 1 else 0 end) as specificity
      from commission_rules
     where transaction_type = ${query.transactionType}
       and effective_from <= ${at}
       and (effective_to is null or effective_to > ${at})
       and (country_code is null or country_code = ${query.countryCode ?? null})
       and (category_id  is null or category_id  = ${query.categoryId ?? null}::uuid)
       and (store_id     is null or store_id     = ${query.storeId ?? null}::uuid)
     order by specificity desc, priority desc, effective_from desc, id desc
     limit 1
  `);

  const row = rows.rows[0];
  if (row === undefined) throw new NoCommissionRuleError(query.transactionType);
  return {
    id: row.id,
    rateBps: row.rate_bps,
    fixedMinor:
      row.fixed_minor === null ? null : typeof row.fixed_minor === "bigint" ? row.fixed_minor : BigInt(row.fixed_minor),
    priority: row.priority,
    specificity: Number(row.specificity),
  };
}

export interface ScheduleInput {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly gross: Money;
  readonly transactionType: string;
  readonly countryCode?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly storeId?: string | undefined;
  /** Referral share of the PLATFORM's commission, never of the gross. */
  readonly referralRateBps?: number | undefined;
  readonly at?: Date | undefined;
}

export interface FrozenSchedule {
  readonly scheduleId: string;
  readonly gross: Money;
  readonly seller: Money;
  readonly platform: Money;
  readonly referral: Money | undefined;
  readonly ruleId: string;
}

/**
 * Resolves the rules once and freezes the outcome.
 *
 * After this returns, changing a commission rule cannot alter what this sale
 * charged: the answer lives in fee_lines, which the database refuses to update
 * or delete. The lines are also asserted to re-sum to the gross, so a split
 * that does not add up cannot be written at all.
 */
export async function freezeSchedule(db: Database, input: ScheduleInput): Promise<FrozenSchedule> {
  const rule = await resolveRule(db, {
    transactionType: input.transactionType,
    ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
    ...(input.at !== undefined ? { at: input.at } : {}),
  });

  const lines: SplitLine[] = [
    {
      key: "platform",
      basis: "gross",
      ...(rule.rateBps !== null ? { rateBps: rule.rateBps } : {}),
      ...(rule.fixedMinor !== null ? { fixedMinor: rule.fixedMinor } : {}),
    },
  ];
  if (input.referralRateBps !== undefined) {
    lines.push({
      key: "referral",
      basis: { line: "platform" },
      rateBps: input.referralRateBps,
      deductFrom: "platform",
    });
  }

  const split = allocate(input.gross, { lines, residualTo: "seller" });
  const seller = amountOf(split, "seller");
  const platform = amountOf(split, "platform");
  const referral = input.referralRateBps === undefined ? undefined : amountOf(split, "referral");

  const scheduleId = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(schema.feeSchedules).values({
      id: scheduleId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      grossMinor: input.gross.amountMinor,
      currency: input.gross.currency,
    });

    const rows: (typeof schema.feeLines.$inferInsert)[] = [
      {
        id: uuidv7(), scheduleId, key: "platform", ruleId: rule.id, basis: "gross",
        ...(rule.rateBps !== null ? { rateBps: rule.rateBps } : {}),
        amountMinor: platform.amountMinor, currency: input.gross.currency,
      },
      {
        // The residual is arithmetic, not a rule: gross minus everything else.
        id: uuidv7(), scheduleId, key: "seller", basis: "residual",
        amountMinor: seller.amountMinor, currency: input.gross.currency,
      },
    ];
    if (referral !== undefined && input.referralRateBps !== undefined) {
      rows.push({
        id: uuidv7(), scheduleId, key: "referral", basis: "line:platform",
        rateBps: input.referralRateBps, amountMinor: referral.amountMinor,
        currency: input.gross.currency,
      });
    }
    await tx.insert(schema.feeLines).values(rows);
  });

  return { scheduleId, gross: input.gross, seller, platform, referral, ruleId: rule.id };
}

/** Re-reads a frozen schedule. This, not the rules, explains a past settlement. */
export async function readSchedule(
  db: Database,
  subjectType: string,
  subjectId: string,
): Promise<{ scheduleId: string; gross: Money; lines: Map<string, Money> } | undefined> {
  const rows = await db.execute<{
    schedule_id: string; gross_minor: bigint | string; currency: string;
    key: string; amount_minor: bigint | string;
  }>(sql`
    select s.id as schedule_id, s.gross_minor, s.currency, l.key, l.amount_minor
      from fee_schedules s join fee_lines l on l.schedule_id = s.id
     where s.subject_type = ${subjectType} and s.subject_id = ${subjectId}::uuid
  `);
  const first = rows.rows[0];
  if (first === undefined) return undefined;

  const toBig = (v: bigint | string): bigint => (typeof v === "bigint" ? v : BigInt(v));
  const lines = new Map<string, Money>();
  for (const r of rows.rows) lines.set(r.key, money(toBig(r.amount_minor), r.currency));
  return {
    scheduleId: first.schedule_id,
    gross: money(toBig(first.gross_minor), first.currency),
    lines,
  };
}
