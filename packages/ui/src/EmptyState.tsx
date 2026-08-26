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
export function EmptyState({
  icon, title, body, action, className = "",
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex flex-col items-center gap-4 rounded-[var(--radius-xl)] border " +
        "border-border bg-surface-muted/60 px-6 py-12 text-center " + className
      }
    >
      {icon !== undefined && (
        <div
          aria-hidden="true"
          className="grid h-14 w-14 place-items-center rounded-[var(--radius-lg)] bg-surface text-copper shadow-[var(--shadow-sm)]"
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-h3 text-foreground">{title}</p>
        {body !== undefined && (
          <p className="mx-auto max-w-[44ch] text-small text-muted">{body}</p>
        )}
      </div>
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
