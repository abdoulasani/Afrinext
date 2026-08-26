import type { ReactNode } from "react";

/**
 * A short, factual statement about how a transaction works.
 *
 * This component exists to make a specific kind of lying difficult. A
 * marketplace wanting to look trustworthy reaches for badges — "Paiement
 * 100% sécurisé", "Satisfait ou remboursé", a padlock, a shield — most of
 * which are claims nobody has checked and some of which are simply false.
 *
 * A TrustNote says only what Afrinext actually does: the file is available
 * immediately after payment, the licence is the seller's own words, a refund
 * follows the refund policy. If a line here cannot be traced to behaviour in
 * the domain, it does not belong on the screen — so the component takes plain
 * text from a translated catalogue rather than offering a menu of reassuring
 * badges to pick from.
 *
 * Visually quiet on purpose. Trust that shouts reads as trust being sold.
 */
export function TrustNote({
  icon, children, tone = "muted", className = "",
}: {
  icon?: ReactNode;
  children: ReactNode;
  /** `confirmed` is the acacia green, and means something has HAPPENED. */
  tone?: "muted" | "confirmed" | "onInk";
  className?: string;
}) {
  const tones = {
    muted: "text-muted",
    confirmed: "text-accent",
    onInk: "text-[var(--on-ink-muted)]",
  } as const;

  return (
    <p className={"flex items-start gap-2 text-small " + tones[tone] + " " + className}>
      {icon !== undefined && (
        <span aria-hidden="true" className="mt-[3px] shrink-0">{icon}</span>
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A check inside a circle. The only "trust" glyph, used sparingly. */
export function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </svg>
  );
}
