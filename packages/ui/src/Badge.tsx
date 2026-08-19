import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "primary" | "accent";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-muted",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
};

/** A small status pill. Colours come from tokens, never from literals. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
