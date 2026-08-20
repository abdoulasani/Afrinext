"use client";

import { useActionState } from "react";
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
  labels: { heading: string; explain: string; version: string; placeholder: string; accept: string };
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, dispatch, pending] = useActionState(action, {});

  return (
    <section
      data-testid="consent-gate"
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-4"
    >
      <h2 className="text-sm font-semibold">{labels.heading}</h2>
      <p className="text-sm text-muted">{labels.explain}</p>

      <ul className="flex flex-col gap-2">
        {documents.map((doc) => (
          <li key={`${doc.kind}:${doc.version}`} className="rounded-lg bg-surface-muted px-3 py-2">
            <p className="text-sm font-medium">{doc.kind}</p>
            <p className="font-mono text-xs text-muted">
              {labels.version} {doc.version} · {doc.locale}
            </p>
            {/* The texts are a legal deliverable that does not exist yet. Saying
                so is better than rendering an empty box that looks like terms. */}
            <p className="mt-1 text-xs text-muted">{labels.placeholder}</p>
          </li>
        ))}
      </ul>

      <form action={dispatch}>
        <input type="hidden" name="locale" value={locale} />
        {state.error !== undefined && (
          <p role="alert" className="mb-2 rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          data-testid="consent-accept"
          className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-contrast disabled:opacity-60"
        >
          {labels.accept}
        </button>
      </form>
    </section>
  );
}
