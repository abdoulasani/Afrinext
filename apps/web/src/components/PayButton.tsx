"use client";

import { useActionState } from "react";
import { payOrderAction, type ActionState } from "@/lib/order-actions";

/**
 * Starts the charge.
 *
 * Nothing about the amount is in this component, and that is the point: it
 * posts an order id, and the server reads what that order costs. A button that
 * carried a price would be a button someone could edit.
 */
export default function PayButton({
  locale, orderId, label, waiting,
}: {
  locale: string;
  orderId: string;
  label: string;
  waiting: string;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(payOrderAction, {});

  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orderId" value={orderId} />
      {state.error !== undefined && (
        <p role="alert" className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        data-testid="pay"
        className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-contrast disabled:opacity-60"
      >
        {label}
      </button>
      <p data-testid="pay-waiting" className="text-center text-xs text-muted">
        {waiting}
      </p>
    </form>
  );
}
