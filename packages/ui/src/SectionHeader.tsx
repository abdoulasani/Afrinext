import type { ReactNode } from "react";

/**
 * The heading of a section, and the rhythm of every discovery page.
 *
 * It exists so that "how a section announces itself" is decided once. The old
 * pages each rolled their own — one used an uppercase 13px label, another an
 * 18px heading, a third both — and that inconsistency is most of what makes an
 * interface feel assembled rather than designed.
 *
 * The eyebrow is the small uppercase line above the title. It carries the
 * category and lets the title itself stay a plain, strong noun phrase instead
 * of a label doing two jobs.
 */
export function SectionHeader({
  title, eyebrow, body, action, className = "", id,
}: {
  title: string;
  eyebrow?: string;
  body?: string;
  /** Usually a "see all" link. Optional, and quiet when present. */
  action?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={"flex items-end justify-between gap-4 " + className}>
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <p className="text-label uppercase text-copper">{eyebrow}</p>
        )}
        <h2 id={id} className="mt-1.5 text-h2 text-foreground">
          {title}
        </h2>
        {body !== undefined && (
          <p className="mt-1 max-w-[52ch] text-small text-muted">{body}</p>
        )}
      </div>
      {action !== undefined && <div className="shrink-0 pb-0.5">{action}</div>}
    </div>
  );
}
