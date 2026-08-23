import type { ReactNode } from "react";

/**
 * The surface everything sits on.
 *
 * `interactive` adds the lift a card gets when it is a link. A card that does
 * not move on hover is a card that is not clickable — the motion is the
 * affordance, so it is tied to the prop rather than applied everywhere.
 */
export function Card({
  children, className = "", interactive = false, as: Tag = "div", ...rest
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  as?: "div" | "article" | "section" | "li";
  /** Passed straight through, so a caller can label a card for a test. */
  "data-testid"?: string;
}) {
  return (
    <Tag
      {...rest}
      className={
        "rounded-[var(--radius-lg)] border border-border bg-surface " +
        (interactive
          ? "shadow-[var(--shadow-sm)] transition-[box-shadow,transform] duration-[var(--duration-fast)] " +
            "ease-[var(--ease-out)] hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5 "
          : "") +
        className
      }
    >
      {children}
    </Tag>
  );
}
