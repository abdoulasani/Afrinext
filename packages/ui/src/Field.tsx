import type { ReactNode } from "react";

/**
 * A labelled form control, with its error and its hint.
 *
 * The label is a real `<label>` bound by id, the error is wired through
 * `aria-describedby` and `aria-invalid`, and the hint sits in the same
 * description. That is the whole reason this component exists: those three
 * attributes are easy to forget on one field out of twenty, and a screen
 * reader user then meets an input with no name and an error nobody announces.
 *
 * Errors are sentences, not codes. Nothing here ever renders a database
 * message.
 */
export function Field({
  id, label, hint, error, required = false, children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    required: boolean;
  }) => ReactNode;
}) {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-foreground">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-primary">*</span>
        )}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error !== undefined ? true : undefined,
        required,
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-xs leading-relaxed text-muted">{hint}</p>
      )}
      {error !== undefined && (
        /* Not colour alone: the message itself carries the meaning. */
        <p id={errorId} role="alert" className="text-xs font-medium text-primary">
          {error}
        </p>
      )}
    </div>
  );
}

/** The one input style. Tall enough to tap, quiet enough to disappear. */
export const inputClass =
  "w-full rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-3 text-[15px] " +
  "text-foreground placeholder:text-muted/70 transition-colors duration-[var(--duration-fast)] " +
  "hover:border-muted/50 aria-[invalid=true]:border-primary";
