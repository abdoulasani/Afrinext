"use client";

import { Button } from "@afrinext/ui";

export type ProgrammeOption = {
  readonly value: "vendeur" | "entrepreneur";
  readonly name: string;
  readonly price: string;
  readonly pitch: string;
};

/**
 * The first thing signup asks, and the most misread screen in the flow.
 *
 * A card that says "2 000 FCFA / mois" next to a button that says "Continuer"
 * reads as a checkout, and it is not one: choosing Entrepreneur here records an
 * intent and charges nothing. So the paid card carries the plain sentence that
 * says so, on screen, before the choice — not in a confirmation afterwards, by
 * which point somebody already believes they have bought something.
 *
 * The two cards are a radio group rather than two buttons because they are one
 * answer to one question, and because a keyboard should move between them with
 * arrows the way it does in every other radio group a person has ever used.
 */
export function ProgrammeChoice({
  options, value, onChange, notPaid, paymentUnavailable, title, intro,
}: {
  options: readonly ProgrammeOption[];
  value: ProgrammeOption["value"];
  onChange: (value: ProgrammeOption["value"]) => void;
  notPaid: string;
  paymentUnavailable: string;
  title: string;
  intro: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-h3 text-foreground">{title}</legend>
      <p className="text-small text-muted">{intro}</p>

      <div className="mt-1 flex flex-col gap-3">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              data-testid={`programme-${option.value}`}
              data-selected={selected}
              className={
                "relative flex cursor-pointer gap-3 rounded-[var(--radius-lg)] border px-4 py-4 " +
                "transition-[border-color,background-color] duration-[var(--duration-fast)] " +
                (selected
                  ? "border-copper bg-[var(--copper-soft)]"
                  : "border-border bg-surface hover:border-border-strong")
              }
            >
              <input
                type="radio"
                name="programme"
                value={option.value}
                checked={selected}
                onChange={() => { onChange(option.value); }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--copper)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-body font-semibold text-foreground">{option.name}</span>
                  <span className="text-small font-semibold tabular-nums text-copper">
                    {option.price}
                  </span>
                </span>
                <span className="mt-1 block text-small text-muted">{option.pitch}</span>

                {option.value === "entrepreneur" && selected && (
                  /*
                   * Said before the choice is submitted, not after. The whole
                   * separation between "chosen", "subscribed" and "paid" is
                   * invisible to the person on this screen; this sentence is
                   * where it becomes visible.
                   */
                  <span
                    data-testid="programme-not-paid"
                    className="mt-3 block rounded-[var(--radius-md)] bg-surface px-3 py-2.5 text-caption text-muted"
                  >
                    {notPaid} {paymentUnavailable}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The same choice, offered again to somebody who already has an account. */
export function ProgrammeSwitch({
  options, current, onChoose, busy, submitLabel, notPaid, paymentUnavailable, title, intro,
}: {
  options: readonly ProgrammeOption[];
  current: ProgrammeOption["value"];
  onChoose: (value: ProgrammeOption["value"]) => void;
  busy: boolean;
  submitLabel: string;
  notPaid: string;
  paymentUnavailable: string;
  title: string;
  intro: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ProgrammeChoice
        options={options}
        value={current}
        onChange={onChoose}
        notPaid={notPaid}
        paymentUnavailable={paymentUnavailable}
        title={title}
        intro={intro}
      />
      <Button type="submit" variant="solid" size="lg" loading={busy} className="w-full">
        {submitLabel}
      </Button>
    </div>
  );
}
