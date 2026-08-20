"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/catalog-actions";

// The same shapes the sign-in form uses, from the same tokens. No hex here.
const field =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base outline-none " +
  "focus:border-primary";
const button =
  "w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-contrast " +
  "disabled:opacity-60";

function Error({ state }: { state: ActionState }) {
  if (state.error === undefined) return null;
  return (
    <p role="alert" className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
      {state.error}
    </p>
  );
}

/**
 * Forms are plain server-action posts.
 *
 * Nothing here validates on the client's behalf: the price is parsed and the
 * permission is checked on the server, and this markup only decides what the
 * person sees. Frontend validation is a courtesy, never a control.
 */
export function CreateStoreForm({
  locale, labels, action,
}: {
  locale: string;
  labels: { name: string; tagline: string; submit: string };
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <Error state={state} />
      <label className="block">
        <span className="text-xs font-medium text-muted">{labels.name}</span>
        <input name="name" required minLength={3} className={`mt-1 ${field}`} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">{labels.tagline}</span>
        <input name="tagline" className={`mt-1 ${field}`} />
      </label>
      <button type="submit" disabled={pending} className={button}>{labels.submit}</button>
    </form>
  );
}

export function CreateProductForm({
  locale, storeSlug, currency, labels, action,
}: {
  locale: string;
  storeSlug: string;
  currency: string;
  labels: { title: string; summary: string; price: string; submit: string };
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="currency" value={currency} />
      <Error state={state} />
      <label className="block">
        <span className="text-xs font-medium text-muted">{labels.title}</span>
        <input name="title" required minLength={3} className={`mt-1 ${field}`} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">{labels.summary}</span>
        <input name="summary" className={`mt-1 ${field}`} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">
          {labels.price} ({currency})
        </span>
        <input name="price" required inputMode="decimal" className={`mt-1 ${field}`} />
      </label>
      <button type="submit" disabled={pending} className={button}>{labels.submit}</button>
    </form>
  );
}

/** One-button posts: publish a store, publish a product. */
export function PublishButton({
  locale, storeSlug, productId, label, action,
}: {
  locale: string;
  storeSlug: string;
  productId?: string;
  label: string;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeSlug" value={storeSlug} />
      {productId !== undefined && <input type="hidden" name="productId" value={productId} />}
      <Error state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-accent px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-60"
      >
        {label}
      </button>
    </form>
  );
}
