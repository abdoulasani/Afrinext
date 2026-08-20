"use client";

import { useActionState } from "react";
import { startCheckoutAction, type ActionState } from "@/lib/order-actions";

/**
 * The buy button on a public product page.
 *
 * It sends a store slug, a product slug and the idempotency key minted when the
 * page rendered. It does not send a price. Two taps carry the same key and
 * therefore reach the same order.
 */
export default function BuyButton({
  locale, storeSlug, productSlug, checkoutKey, label,
}: {
  locale: string;
  storeSlug: string;
  productSlug: string;
  checkoutKey: string;
  label: string;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(startCheckoutAction, {});

  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="checkoutKey" value={checkoutKey} />
      {state.error !== undefined && (
        <p role="alert" data-testid="buy-error" className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        data-testid="buy"
        className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-contrast disabled:opacity-60"
      >
        {label}
      </button>
    </form>
  );
}
