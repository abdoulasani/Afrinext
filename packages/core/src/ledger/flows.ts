import type { Database } from "@afrinext/db";
import { allocate, amountOf, type Money, type SplitLine } from "../money";
import { platformAccount, userAccount } from "./accounts";
import { post, type PostedTransaction, type Transfer } from "./post";

/**
 * The confirmed Afrinext money flow, expressed as ledger movements.
 *
 * These helpers exist so the economic model lives in one reviewable place
 * rather than being reassembled at each call site. They record *entitlement* —
 * who Afrinext owes what — and say nothing about where money physically sits
 * or about custody, which are separate questions settled by layers F and G of
 * the architecture.
 */

export interface CaptureInput {
  readonly gross: Money;
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Step 1 — the customer has paid and the provider holds the funds. */
export function recordCapture(db: Database, input: CaptureInput): Promise<PostedTransaction> {
  return post(db, {
    kind: "capture",
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
    transfers: [
      {
        from: platformAccount("external_customer", input.gross.currency),
        to: platformAccount("psp_clearing", input.gross.currency),
        amount: input.gross,
      },
    ],
  });
}

/** Step 2 — the provider has settled to Afrinext; the funds are now escrowed. */
export function recordProviderSettlement(
  db: Database,
  input: CaptureInput,
): Promise<PostedTransaction> {
  return post(db, {
    kind: "settlement",
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
    transfers: [
      {
        from: platformAccount("psp_clearing", input.gross.currency),
        to: platformAccount("platform_escrow", input.gross.currency),
        amount: input.gross,
      },
    ],
  });
}

export interface SaleSettlementInput {
  readonly gross: Money;
  readonly sellerUserId: string;
  /** Afrinext's commission on the sale, in basis points. 1800 = 18.00%. */
  readonly platformRateBps: number;
  /**
   * Referral share, in basis points **of Afrinext's commission** — never of the
   * gross. This is what bounds the referral payout by what Afrinext actually
   * earned on the sale, and it is the reason the basis is not configurable to
   * "gross" here.
   */
  readonly referral?: { readonly ambassadorUserId: string; readonly rateBps: number } | undefined;
  /** Seller funds land in pending when the sale still has a refund window. */
  readonly holdSellerFunds: boolean;
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SaleSettlementResult extends PostedTransaction {
  readonly sellerAmount: Money;
  readonly platformAmount: Money;
  readonly referralAmount: Money | undefined;
}

/**
 * Step 3 — split the escrowed gross into the parties' entitlements.
 *
 * The seller receives the residual: every other line is rounded half-up and the
 * seller's share is `gross - sum(other lines)`. The split therefore re-sums to
 * the gross exactly, so no minor unit is created or destroyed by rounding.
 */
export async function settleSale(
  db: Database,
  input: SaleSettlementInput,
): Promise<SaleSettlementResult> {
  const currency = input.gross.currency;

  const lines: SplitLine[] = [
    { key: "platform", basis: "gross", rateBps: input.platformRateBps },
  ];
  if (input.referral !== undefined) {
    lines.push({
      key: "referral",
      basis: { line: "platform" },
      rateBps: input.referral.rateBps,
      deductFrom: "platform",
    });
  }

  const split = allocate(input.gross, { lines, residualTo: "seller" });
  const sellerAmount = amountOf(split, "seller");
  const platformAmount = amountOf(split, "platform");
  const referralAmount = input.referral === undefined ? undefined : amountOf(split, "referral");

  const sellerKind = input.holdSellerFunds ? "user_pending" : "user_available";
  const escrow = platformAccount("platform_escrow", currency);

  const transfers: Transfer[] = [];
  if (sellerAmount.amountMinor > 0n) {
    transfers.push({
      from: escrow,
      to: userAccount(sellerKind, input.sellerUserId, currency),
      amount: sellerAmount,
    });
  }
  if (platformAmount.amountMinor > 0n) {
    transfers.push({
      from: escrow,
      to: platformAccount("platform_revenue", currency),
      amount: platformAmount,
    });
  }
  if (referralAmount !== undefined && referralAmount.amountMinor > 0n && input.referral !== undefined) {
    // Referral commission is always held until the sale's refund window closes,
    // so a refunded sale never pays a commission out.
    transfers.push({
      from: escrow,
      to: userAccount("user_pending", input.referral.ambassadorUserId, currency),
      amount: referralAmount,
    });
  }

  const posted = await post(db, {
    kind: "settlement",
    idempotencyKey: input.idempotencyKey,
    metadata: {
      ...(input.metadata ?? {}),
      split: {
        seller: sellerAmount.amountMinor.toString(),
        platform: platformAmount.amountMinor.toString(),
        referral: referralAmount?.amountMinor.toString() ?? null,
        currency,
      },
    },
    transfers,
  });

  return { ...posted, sellerAmount, platformAmount, referralAmount };
}

/** Pending funds become withdrawable once their hold expires. */
export function releaseHold(
  db: Database,
  input: { userId: string; amount: Money; idempotencyKey: string },
): Promise<PostedTransaction> {
  return post(db, {
    kind: "adjustment",
    idempotencyKey: input.idempotencyKey,
    metadata: { reason: "hold_released" },
    transfers: [
      {
        from: userAccount("user_pending", input.userId, input.amount.currency),
        to: userAccount("user_available", input.userId, input.amount.currency),
        amount: input.amount,
      },
    ],
  });
}

/**
 * A payout leaves the withdrawable balance at approval, not at execution, so
 * the same funds cannot be requested twice while a payout is in flight.
 */
export function approvePayout(
  db: Database,
  input: { userId: string; amount: Money; idempotencyKey: string; approvedBy: string },
): Promise<PostedTransaction> {
  return post(db, {
    kind: "payout_approved",
    idempotencyKey: input.idempotencyKey,
    metadata: { approvedBy: input.approvedBy },
    transfers: [
      {
        from: userAccount("user_available", input.userId, input.amount.currency),
        to: platformAccount("payout_payable", input.amount.currency),
        amount: input.amount,
      },
    ],
  });
}

/** The payout has been executed and the money has left Afrinext. */
export function settlePayout(
  db: Database,
  input: { amount: Money; idempotencyKey: string; providerRef?: string },
): Promise<PostedTransaction> {
  return post(db, {
    kind: "payout_settled",
    idempotencyKey: input.idempotencyKey,
    metadata: { providerRef: input.providerRef ?? null },
    transfers: [
      {
        from: platformAccount("payout_payable", input.amount.currency),
        to: platformAccount("external_payout", input.amount.currency),
        amount: input.amount,
      },
    ],
  });
}

/**
 * A failed payout returns the funds to the user's withdrawable balance.
 * No payout ever disappears: it either settles or is explicitly returned.
 */
export function failPayout(
  db: Database,
  input: { userId: string; amount: Money; idempotencyKey: string; reason: string },
): Promise<PostedTransaction> {
  return post(db, {
    kind: "payout_failed",
    idempotencyKey: input.idempotencyKey,
    metadata: { reason: input.reason },
    transfers: [
      {
        from: platformAccount("payout_payable", input.amount.currency),
        to: userAccount("user_available", input.userId, input.amount.currency),
        amount: input.amount,
      },
    ],
  });
}
