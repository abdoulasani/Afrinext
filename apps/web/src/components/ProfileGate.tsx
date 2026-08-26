"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/order-actions";

export type SelectableCountry = { code: string; name: string };

/**
 * The name and country a payment provider asks for.
 *
 * This is presentation. The gate is `requireCompleteProfile` inside
 * `initiatePayment`, and it does not consult anything rendered here — someone
 * who deletes this form from the DOM and posts the pay action directly is
 * refused exactly the same way, before any payment row is written.
 *
 * There is no identifier in this form, and that is deliberate: the server
 * writes the session's own row, so there is no field to tamper with. The only
 * thing a person can change here is their own name and their own country.
 */
export default function ProfileGate({
  locale,
  countries,
  labels,
  action,
}: {
  locale: string;
  countries: readonly SelectableCountry[];
  labels: {
    heading: string;
    explain: string;
    nameLabel: string;
    namePlaceholder: string;
    countryLabel: string;
    countryPlaceholder: string;
    save: string;
    privacy: string;
  };
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <section
      data-testid="profile-gate"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-4"
    >
      <h2 className="text-small font-semibold">{labels.heading}</h2>
      <p className="text-small text-muted">{labels.explain}</p>

      <form action={dispatch} className="flex flex-col gap-3">
        <input type="hidden" name="locale" value={locale} />

        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted">{labels.nameLabel}</span>
          <input
            type="text"
            name="fullName"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            data-testid="profile-name"
            placeholder={labels.namePlaceholder}
            className="rounded-xl border border-border bg-surface-muted px-3 py-2.5 text-small"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted">{labels.countryLabel}</span>
          <select
            name="country"
            required
            defaultValue=""
            data-testid="profile-country"
            className="rounded-xl border border-border bg-surface-muted px-3 py-2.5 text-small"
          >
            <option value="" disabled>
              {labels.countryPlaceholder}
            </option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>

        {state.error !== undefined && (
          <p
            role="alert"
            data-testid="profile-error"
            className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          data-testid="profile-save"
          className="w-full rounded-[var(--radius-md)] bg-primary px-4 py-3 text-small font-semibold text-primary-contrast disabled:opacity-60"
        >
          {labels.save}
        </button>

        {/* Said before they type it, not after. */}
        <p className="text-caption text-muted">{labels.privacy}</p>
      </form>
    </section>
  );
}
