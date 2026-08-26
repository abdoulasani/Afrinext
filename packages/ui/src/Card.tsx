import type { ReactNode } from "react";

export type CardTone = "surface" | "sunken" | "ink";

/**
 * The surface things sit on — used less than it was.
 *
 * The previous marketplace put every single item in a bordered, shadowed box,
 * and a page where everything is a card is a page where nothing is emphasised:
 * the boxes become the texture and the content disappears into them. So the
 * new rows use plain rhythm and type for most things, and reach for a Card
 * only when an item is genuinely a separate object the reader might act on.
 *
 * `interactive` adds the lift a card gets when it is a link. Motion IS the
 * affordance, so it belongs to the prop rather than to every card.
 */
export function Card({
  children, className = "", interactive = false, tone = "surface",
  as: Tag = "div", ...rest
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  tone?: CardTone;
  as?: "div" | "article" | "section" | "li";
  "data-testid"?: string;
}) {
  const tones: Record<CardTone, string> = {
    surface: "border border-border bg-surface",
    sunken: "border border-transparent bg-surface-muted",
    ink: "border border-[var(--on-ink-line)] bg-ink text-[var(--on-ink)] on-ink",
  };

  return (
    <Tag
      {...rest}
      className={
        "rounded-[var(--radius-lg)] " + tones[tone] + " " +
        (interactive
          ? "transition-[box-shadow,transform,border-color] duration-[var(--duration-base)] " +
            "ease-[var(--ease-out)] hover:-translate-y-[3px] hover:shadow-[var(--shadow-lg)] " +
            "hover:border-border-strong active:translate-y-0 active:duration-[80ms] "
          : "") +
        className
      }
    >
      {children}
    </Tag>
  );
}
