"use client";

import { useActionState } from "react";
import { Button } from "@afrinext/ui";
import { startCheckoutAction, type ActionState } from "@/lib/order-actions";

/**
 * The buy button on a public product page.
 *
 * It sends a store slug, a product slug and the idempotency key minted when the
 * page rendered. It does not send a price. Two taps carry the same key and
 * therefore reach the same order.
 *
 * It is the one place on the marketplace that spends the copper `accent`
 * variant. That is the whole discipline of the palette in one component: the
 * accent is worth something because buying is the only thing wearing it, and a
 * page that put copper on three buttons would have made this one ordinary.
 *
 * `loading` rather than a disabled label swap: the button keeps its exact width
 * while the checkout is in flight, so the bar it sits in does not jump under
 * the thumb that just tapped it.
 */
export default function BuyButton({
  locale, storeSlug, productSlug, checkoutKey, label, fullWidth = false,
}: {
  locale: string;
  storeSlug: string;
  productSlug: string;
  checkoutKey: string;
  label: string;
  fullWidth?: boolean;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(startCheckoutAction, {});

  return (
    <form action={dispatch} className={fullWidth ? "flex flex-col gap-2" : "contents"}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <input type="hidden" name="checkoutKey" value={checkoutKey} />
      {state.error !== undefined && (
        <p
          role="alert"
          data-testid="buy-error"
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-2 text-small font-medium text-[var(--danger)]"
        >
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        variant="accent"
        size="lg"
        loading={pending}
        data-testid="buy"
        className={fullWidth ? "w-full" : ""}
      >
        {label}
      </Button>
    </form>
  );
}
