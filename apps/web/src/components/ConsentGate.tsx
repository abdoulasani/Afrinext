"use client";

import { useActionState } from "react";
import { Button } from "@afrinext/ui";
import type { ActionState } from "@/lib/catalog-actions";

export type OutstandingDocument = {
  kind: string;
  version: string;
  locale: string;
  contentHash: string;
};

/**
 * The document, its exact version, and an explicit acceptance.
 *
 * This is presentation. The gate is `requireConsent` inside `createStore`, and
 * it does not consult anything rendered here — a person who never loads this
 * component, or who deletes it from the DOM, is refused exactly the same way.
 * What this adds is the chance to actually read what is being agreed to, and a
 * record of the version that was on screen when they did.
 */
export default function ConsentGate({
  locale,
  documents,
  labels,
  action,
}: {
  locale: string;
  documents: readonly OutstandingDocument[];
  labels: {
    heading: string; explain: string; version: string; placeholder: string; accept: string;
    /**
     * What each document is CALLED, keyed by its stored kind.
     *
     * Without this the gate printed `seller_terms` — a database enum — to a
     * seller being asked to agree to it. A person cannot consent to a value
     * they cannot read, and the sign-in form already did this correctly, which
     * made the omission here a straightforward inconsistency rather than a
     * missing feature. The kind is still the fallback, so a document type added
     * tomorrow renders its key instead of nothing.
     */
    documentNames?: Readonly<Record<string, string>>;
  };
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, dispatch, pending] = useActionState(action, {});

  return (
    <section
      data-testid="consent-gate"
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-5"
    >
      <h2 className="text-h3 text-foreground">{labels.heading}</h2>
      <p className="text-small text-muted">{labels.explain}</p>

      <ul className="flex flex-col gap-2">
        {documents.map((doc) => (
          <li
            key={`${doc.kind}:${doc.version}`}
            className="rounded-[var(--radius-md)] bg-surface-muted px-3.5 py-3"
          >
            <p className="text-small font-semibold text-foreground">
              {labels.documentNames?.[doc.kind] ?? doc.kind}
            </p>
            <p className="mt-0.5 text-caption tabular-nums text-muted">
              {labels.version} {doc.version} · {doc.locale}
            </p>
            {/* The texts are a legal deliverable that does not exist yet. Saying
                so is better than rendering an empty box that looks like terms. */}
            <p className="mt-1 text-caption text-muted">{labels.placeholder}</p>
          </li>
        ))}
      </ul>

      <form action={dispatch}>
        <input type="hidden" name="locale" value={locale} />
        {state.error !== undefined && (
          <p role="alert" className="mb-2 rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]">
            {state.error}
          </p>
        )}
        <Button
          type="submit"
          variant="solid"
          size="lg"
          loading={pending}
          data-testid="consent-accept"
          className="w-full"
        >
          {labels.accept}
        </Button>
      </form>
    </section>
  );
}
