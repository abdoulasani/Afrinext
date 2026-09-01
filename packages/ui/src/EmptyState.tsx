import type { ReactNode } from "react";

/**
 * What a screen says when it has nothing to show.
 *
 * Afrinext will launch with an empty marketplace, so this component is not an
 * edge case — it is the first thing most visitors see, and it has to be as
 * considered as the populated state. It always offers a next action, because a
 * screen that says "nothing here" and stops is a dead end.
 *
 * It never fabricates. An empty marketplace says it is empty and invites the
 * first store; it does not show placeholder products to look busy.
 *
 * The border is solid rather than dashed, which is a small change with a large
 * effect: a dashed outline is the visual language of a drop zone or a missing
 * asset, so it made a deliberate state look like a broken one.
 */
/*
 * The same six names the service tiles, the category tiles and the store
 * identities use. One vocabulary: a screen that knows its tone can hand it to
 * any of them without a translation step, and adding a seventh place to spell
 * the palette differently is how a design system quietly forks.
 */
export type EmptyTone =
  | "laterite" | "forest" | "indigo" | "ochre" | "aubergine" | "clay";

const TONES: Record<EmptyTone, { bg: string; fg: string }> = {
  laterite: { bg: "var(--brand-laterite-soft)", fg: "var(--brand-laterite)" },
  forest: { bg: "var(--brand-forest-soft)", fg: "var(--brand-forest)" },
  indigo: { bg: "var(--brand-indigo-soft)", fg: "var(--brand-indigo)" },
  ochre: { bg: "var(--brand-ochre-soft)", fg: "var(--brand-ochre)" },
  aubergine: { bg: "var(--brand-aubergine-soft)", fg: "var(--brand-aubergine)" },
  clay: { bg: "var(--brand-clay-soft)", fg: "var(--brand-clay)" },
};

export function EmptyState({
  icon, title, body, action, tone = "laterite", className = "",
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  /**
   * Which world is empty.
   *
   * An empty library and an empty order list are not the same absence, and
   * carrying the screen's own identity colour into its empty state is what
   * keeps "nothing here yet" feeling like part of the product rather than a
   * generic fallback pasted into six places.
   */
  tone?: EmptyTone;
  className?: string;
}) {
  return (
    <div
      className={
        "flex flex-col items-center gap-4 rounded-[var(--radius-2xl)] border " +
        "border-border bg-surface px-6 py-14 text-center shadow-[var(--shadow-sm)] " + className
      }
    >
      {icon !== undefined && (
        <div
          aria-hidden="true"
          className="grid h-16 w-16 place-items-center rounded-[var(--radius-xl)]"
          style={{ backgroundColor: TONES[tone].bg, color: TONES[tone].fg }}
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-h2 text-foreground">{title}</p>
        {body !== undefined && (
          <p className="mx-auto max-w-[42ch] text-body text-muted">{body}</p>
        )}
      </div>
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
