import Link from "next/link";
import type { Route } from "next";
import type { Locale } from "@afrinext/i18n";
import { icons } from "./icons";

/**
 * The one control in the top-right of the home header.
 *
 * ---------------------------------------------------------------------------
 * Why there is no notification bell here
 * ---------------------------------------------------------------------------
 *
 * The reference composition puts a bell, a phone and a language chip in this
 * corner, and a bell was asked for. Afrinext has no notifications surface: the
 * domain writes to `notification_outbox` and deliberately nothing sends,
 * because no SMS provider has been chosen and none is pretended. A bell here
 * would open nothing, or open an empty screen that has never had anything in
 * it — which is the same class of decoration as a fabricated balance, and the
 * brief that asked for the bell also asked for empty states to stay honest.
 *
 * So the corner carries the language switch, which is real, works, and is the
 * thing a bilingual launch market actually reaches for. The bell goes in the
 * moment there is something for it to show.
 */
export function AppMenuTrigger({ locale, label }: { locale: Locale; label: string }) {
  const other: Locale = locale === "fr" ? "en" : "fr";
  return (
    <Link
      href={`/${other}` as Route}
      hrefLang={other}
      aria-label={`${label}: ${other === "fr" ? "Français" : "English"}`}
      className={
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] " +
        "bg-[var(--on-ink-raised)] px-3.5 text-small font-medium uppercase " +
        "text-[var(--on-ink)] transition-colors duration-[var(--duration-fast)] " +
        "hover:bg-[color-mix(in_srgb,var(--on-ink)_16%,transparent)] " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
        "focus-visible:outline-[var(--copper-on-ink)]"
      }
    >
      {icons.globe}
      {other}
    </Link>
  );
}
