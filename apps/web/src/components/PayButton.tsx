"use client";

import { useActionState } from "react";
import { payOrderAction, type ActionState } from "@/lib/order-actions";

export type OfferedChannel = { value: string; label: string; detail: string };

/**
 * Starts the charge.
 *
 * Nothing about the amount is in this component, and that is the point: it
 * posts an order id and a channel, and the server reads what that order costs.
 * A button that carried a price would be a button someone could edit.
 *
 * The channel IS posted, and is the one thing here a person can influence. It
 * carries Afrinext's vocabulary — `mobile_money` — which is meaningless to
 * iPayMoney, and the server checks it against the launch allowlist before
 * anything is written. Editing this field cannot name a provider header value,
 * because the domain does not accept provider header values from anyone.
 *
 * Afrinext launches with exactly one channel, and it is rendered as a visible,
 * checked radio rather than a hidden input. A payment method the buyer never
 * saw is not a method they chose, and a hidden field would make the single
 * option look like an implementation detail rather than a decision.
 */
export default function PayButton({
  locale, orderId, label, waiting, channels, channelLabels,
}: {
  locale: string;
  orderId: string;
  label: string;
  waiting: string;
  channels: readonly OfferedChannel[];
  channelLabels: { heading: string; onlyOne: string };
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(payOrderAction, {});
  const only = channels[0];

  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orderId" value={orderId} />

      <fieldset className="flex flex-col gap-2" data-testid="channel-choice">
        <legend className="text-xs font-medium text-muted">{channelLabels.heading}</legend>
        {channels.map((channel) => (
          <label
            key={channel.value}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted px-3 py-2.5"
          >
            <input
              type="radio"
              name="channel"
              value={channel.value}
              defaultChecked={channel.value === only?.value}
              required
              data-testid={`channel-${channel.value}`}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{channel.label}</span>
              <span className="text-xs text-muted">{channel.detail}</span>
            </span>
          </label>
        ))}
        {channels.length === 1 && (
          <p className="text-xs text-muted">{channelLabels.onlyOne}</p>
        )}
      </fieldset>

      {state.error !== undefined && (
        <p role="alert" data-testid="pay-error" className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
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
