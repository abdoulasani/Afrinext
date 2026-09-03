"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { icons } from "./icons";

/**
 * The card at the top of the home screen.
 *
 * ---------------------------------------------------------------------------
 * The one thing this card is NOT allowed to say
 * ---------------------------------------------------------------------------
 *
 * The reference this composition follows is a mobile-money app, where the card
 * shows a balance the company is holding for you. **Afrinext holds nothing.**
 * The ledger records an ENTITLEMENT — a contractual claim against Afrinext —
 * and the architecture forbids any screen calling that a deposit or protected
 * funds. So this card borrows the reference's shape and hierarchy and none of
 * its vocabulary: it reuses the exact wording the wallet screen was already
 * reviewed with (`wallet.available`, `wallet.pending`), and the full
 * explanation stays one tap away on the wallet itself rather than being
 * reworded into something friendlier here.
 *
 * Every number is read from the ledger. Nothing is invented to make the card
 * look inhabited: a new account genuinely shows zero, because zero is the true
 * answer and a fabricated one would be the single most damaging thing this
 * redesign could ship.
 *
 * ---------------------------------------------------------------------------
 * Why the amounts can be hidden
 * ---------------------------------------------------------------------------
 *
 * Not decoration copied from the reference. Afrinext is used on shared phones
 * and in markets where the screen is visible to whoever is standing next to
 * you, and the home screen is the one screen that opens without being asked
 * for. The toggle is per-device and remembered in `localStorage`, so it is a
 * preference rather than a setting somebody has to find twice a day.
 */
export function ActivityCard({
  eyebrow, availableLabel, available, pendingLabel, pending,
  walletHref, walletLabel, showLabel, hideLabel, hiddenLabel,
}: {
  eyebrow: string;
  availableLabel: string;
  available: string;
  pendingLabel: string;
  pending: string;
  walletHref: string;
  walletLabel: string;
  showLabel: string;
  hideLabel: string;
  hiddenLabel: string;
}) {
  const [hidden, setHidden] = useState<boolean>(() => {
    // Reading during the initial state calculation, so the first paint is
    // already correct rather than flashing the amount and then hiding it.
    try { return globalThis.localStorage?.getItem("afx.amounts") === "hidden"; }
    catch { return false; }
  });

  const toggle = (): void => {
    setHidden((was) => {
      const next = !was;
      try { globalThis.localStorage?.setItem("afx.amounts", next ? "hidden" : "shown"); }
      catch { /* a private window is not a reason to break the button */ }
      return next;
    });
  };

  // A fixed-width mask rather than the amount blurred: blur still leaks the
  // magnitude, and a row that changes width when toggled makes the card jump.
  const mask = "••• •••";

  return (
    <section
      aria-label={eyebrow}
      /*
       * Indigo on sunset: cool over warm.
       *
       * The card has to be instantly separable from the band it overlaps, and
       * the reliable way to do that is temperature, not brightness — a lighter
       * card on a light-orange band separates only by a step of tone, which
       * disappears the moment a phone is held in sunlight. Cool against warm
       * survives that.
       *
       * Indigo also happens to be the right colour by role rather than only by
       * contrast: it is Afrinext's information tone, and it is the oldest dye
       * in this part of the world. White on it measures 10.89:1, so the
       * largest number on the home screen is also the most legible thing on it.
       */
      className={
        "relative z-10 overflow-hidden rounded-[var(--radius-2xl)] bg-info " +
        "p-5 text-[var(--info-contrast)] shadow-[var(--shadow-lg)] sm:p-6"
      }
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full opacity-[0.22]"
        style={{ background: "radial-gradient(circle, var(--copper) 0%, transparent 68%)" }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-label uppercase text-[color-mix(in_srgb,#fff_72%,transparent)]">{eyebrow}</p>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={hidden}
          data-testid="toggle-amounts"
          className={
            "-m-2 flex h-11 w-11 items-center justify-center rounded-[var(--radius-pill)] " +
            "text-[color-mix(in_srgb,#fff_78%,transparent)] " +
            "transition-colors duration-[var(--duration-fast)] " +
            "hover:bg-[color-mix(in_srgb,#fff_16%,transparent)] hover:text-white " +
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
            "focus-visible:outline-white"
          }
        >
          <span className="sr-only">{hidden ? showLabel : hideLabel}</span>
          {hidden ? icons.eyeOff : icons.eye}
        </button>
      </div>

      <p className="relative mt-4 text-caption text-[color-mix(in_srgb,#fff_78%,transparent)]">{availableLabel}</p>
      <p
        data-testid="activity-available"
        className="relative mt-1 text-display tabular-nums text-white"
      >
        {hidden ? mask : available}
      </p>
      <span className="sr-only" aria-live="polite">{hidden ? hiddenLabel : ""}</span>

      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[color-mix(in_srgb,#fff_22%,transparent)] pt-4">
        <p className="text-caption text-[color-mix(in_srgb,#fff_78%,transparent)]">
          {pendingLabel}{" "}
          <span className="tabular-nums text-white">
            {hidden ? mask : pending}
          </span>
        </p>
        <Link
          href={walletHref as Route}
          className={
            /* The one action inside the card, and it is the brand colour: on a
               cool card, warm is the thing the eye goes to. */
            "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] " +
            "bg-primary px-4 text-small font-medium text-primary-contrast " +
            "transition-colors duration-[var(--duration-fast)] hover:bg-primary-hover " +
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
            "focus-visible:outline-white"
          }
        >
          {walletLabel}
          {icons.arrow}
        </Link>
      </div>
    </section>
  );
}
