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
       * Paper on ink, not ink on ink.
       *
       * The first draft made this card a lighter ink, following a reference
       * whose header is a saturated brand colour — there, a dark card on a
       * bright header separates. On Afrinext the header is already ink, so an
       * ink card merged into it and the whole top of the screen became one
       * heavy block with the balance somewhere inside it.
       *
       * Inverting it is the Afrinext answer rather than the borrowed one: the
       * card is the paper the marketplace is printed on, laid over the ink.
       * It separates completely, it is the brightest thing on the screen at
       * exactly the point the eye lands, and it needs no extra contrast work
       * because it uses the page's own text colours.
       */
      className={
        "relative z-10 rounded-[var(--radius-xl)] border border-border bg-surface " +
        "p-5 shadow-[var(--shadow-lg)] sm:p-6"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-label uppercase text-faint">{eyebrow}</p>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={hidden}
          data-testid="toggle-amounts"
          className={
            "-m-2 flex h-11 w-11 items-center justify-center rounded-[var(--radius-pill)] " +
            "text-muted transition-colors duration-[var(--duration-fast)] " +
            "hover:bg-surface-muted hover:text-foreground " +
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
            "focus-visible:outline-copper"
          }
        >
          <span className="sr-only">{hidden ? showLabel : hideLabel}</span>
          {hidden ? icons.eyeOff : icons.eye}
        </button>
      </div>

      <p className="mt-4 text-caption text-muted">{availableLabel}</p>
      <p
        data-testid="activity-available"
        className="mt-1 text-display tabular-nums text-foreground"
      >
        {hidden ? mask : available}
      </p>
      <span className="sr-only" aria-live="polite">{hidden ? hiddenLabel : ""}</span>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-caption text-muted">
          {pendingLabel}{" "}
          <span className="tabular-nums text-foreground">
            {hidden ? mask : pending}
          </span>
        </p>
        <Link
          href={walletHref as Route}
          className={
            "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] " +
            "bg-primary px-4 text-small font-medium text-primary-contrast " +
            "transition-colors duration-[var(--duration-fast)] hover:bg-primary-hover " +
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
            "focus-visible:outline-copper"
          }
        >
          {walletLabel}
          {icons.arrow}
        </Link>
      </div>
    </section>
  );
}
