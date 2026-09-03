import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "copper" | "accent" | "ink" | "onInk" | "primary";

/*
 * Quiet by default, and that is the point.
 *
 * A badge labels something; it is not the thing. `neutral` carries almost all
 * of them — a store type, a status, a count. `copper` and `accent` are for the
 * two states worth interrupting a reader for: a price-adjacent emphasis, and
 * money confirmed. `onInk` is the same pill sitting on a dark panel.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-muted",
  copper: "bg-copper-soft text-copper",
  accent: "bg-accent-soft text-accent",
  ink: "bg-primary text-primary-contrast",
  onInk: "bg-[var(--on-ink-raised)] text-[var(--on-ink)] backdrop-blur-sm",
  // Retired name, kept so screens not yet redesigned keep compiling.
  primary: "bg-copper-soft text-copper",
};

export function Badge({
  children, tone = "neutral", className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 " +
        "text-caption font-medium leading-none " + TONES[tone] + " " + className
      }
    >
      {children}
    </span>
  );
}
