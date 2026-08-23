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
        "flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed " +
        "border-border bg-surface-muted/50 px-6 py-10 text-center " + className
      }
    >
      {icon !== undefined && (
        <div
          aria-hidden="true"
          className="grid h-12 w-12 place-items-center rounded-full bg-surface text-muted shadow-[var(--shadow-sm)]"
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        {body !== undefined && (
          <p className="mx-auto max-w-[42ch] text-sm leading-relaxed text-muted">{body}</p>
        )}
      </div>
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}
