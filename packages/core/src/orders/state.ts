import { DomainError } from "../errors";

/**
 * The two state machines, written down once.
 *
 * They live here as data rather than as `if` chains at the call sites, because
 * a transition rule that is expressed in three places is a rule that will
 * eventually disagree with itself. The transitions are also enforced a second
 * time by the database — every mutation is a guarded UPDATE whose WHERE clause
 * names the state it expects — so a caller that skipped this table still cannot
 * write an impossible history.
 */

export const ORDER_STATES = [
  "pending_payment",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const PAYMENT_STATES = [
  "initiated",
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/**
 * An order leaves `pending_payment` exactly once and never comes back.
 *
 * `failed` is terminal on purpose. A failed charge does not reopen the order
 * for another attempt: the buyer starts a new checkout, which gets a new
 * idempotency key, a fresh price read and a fresh expiry. Reusing an order
 * across attempts is how a stale price gets charged.
 */
const ORDER_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  pending_payment: ["paid", "failed", "cancelled", "expired"],
  paid: [],
  failed: [],
  cancelled: [],
  expired: [],
};

const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  initiated: ["pending", "succeeded", "failed", "cancelled", "expired"],
  pending: ["succeeded", "failed", "cancelled", "expired"],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
};

/** States after which nothing more can happen. */
export function isTerminalOrderState(state: OrderState): boolean {
  return ORDER_TRANSITIONS[state].length === 0;
}

export function isTerminalPaymentState(state: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[state].length === 0;
}

export function canTransitionOrder(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends DomainError {
  override readonly name = "InvalidTransitionError";
  constructor(subject: "order" | "payment", from: string, to: string) {
    super("order.invalid_transition", `A ${subject} cannot go from ${from} to ${to}.`);
  }
}

export function assertOrderTransition(from: OrderState, to: OrderState): void {
  if (!canTransitionOrder(from, to)) throw new InvalidTransitionError("order", from, to);
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransitionPayment(from, to)) throw new InvalidTransitionError("payment", from, to);
}

/**
 * What a payment state means for the order it belongs to.
 *
 * One mapping, so "succeeded means paid" is a fact of the domain rather than a
 * decision each caller makes. `pending` maps to nothing: an order stays
 * `pending_payment` while a charge is in flight.
 */
export function orderStateForPayment(payment: PaymentState): OrderState | undefined {
  switch (payment) {
    case "succeeded": return "paid";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "expired": return "expired";
    default: return undefined;
  }
}
