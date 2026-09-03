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
      <label htmlFor={id} className="text-small font-medium text-foreground">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-copper">*</span>
        )}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error !== undefined ? true : undefined,
        required,
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-caption text-muted">{hint}</p>
      )}
      {error !== undefined && (
        /* Not colour alone: the message itself carries the meaning. */
        <p id={errorId} role="alert" className="text-caption font-medium text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The one input style.
 *
 * 48px tall, because that is what a thumb needs and because a form whose fields
 * are shorter than its buttons looks like two designs sharing a page. The
 * invalid state is a DANGER border rather than the accent: copper marks things
 * worth attention, red marks things that are wrong, and a field that borrows
 * the accent for an error teaches the reader that copper means trouble.
 */
export const inputClass =
  "h-12 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3.5 text-body " +
  "text-foreground outline-none placeholder:text-faint " +
  "transition-[border-color,box-shadow] duration-[var(--duration-fast)] " +
  "hover:border-border-strong focus:border-copper " +
  "aria-[invalid=true]:border-[var(--danger)]";
