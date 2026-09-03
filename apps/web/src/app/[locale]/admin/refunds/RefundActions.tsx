"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The buttons on one refund.
 *
 * A client component only because it needs `onClick`, and it decides nothing.
 * `mayExecute` and `mayReconcile` come from the server so the page does not
 * render controls that would only fail — but hiding a button is a courtesy,
 * never a control. Every one of these calls lands on a route that re-checks the
 * permission, the step-up elevation and the refund's state in the domain, so an
 * operator with the developer console open gains nothing by making them appear.
 *
 * What is NOT here matters more than what is:
 *
 *   - no "mark as refunded";
 *   - no "cancel this refund";
 *   - no retry on an `in_doubt` refund, because there is no such operation to
 *     call. Resolving is offered instead, which asks the provider rather than
 *     telling it something.
 */
export default function RefundActions({
  refundId,
  status,
  mayExecute,
  mayReconcile,
}: {
  refundId: string;
  status: string;
  mayExecute: boolean;
  mayReconcile: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [outcome, setOutcome] = useState<"succeeded" | "failed">("failed");

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/refunds/${refundId}${path}`, {
        method: "POST",
        ...(body !== undefined
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      const json = (await response.json()) as {
        data?: { status?: string; resolved?: boolean; reason?: string; stage?: string };
        error?: { message?: string };
      };
      setMessage(
        response.ok
          ? [json.data?.status, json.data?.stage, json.data?.reason]
              .filter((v) => v !== undefined)
              .join(" · ")
          : (json.error?.message ?? "Refused."),
      );
      if (response.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  // `owed` and `failed` are the only states a request may leave from. That is
  // the state machine's rule, mirrored here so the screen cannot suggest
  // otherwise — an `in_doubt` refund shows no send button at all.
  const canSend = mayExecute && (status === "owed" || status === "failed");
  const canResolve = mayExecute && (status === "in_doubt" || status === "in_flight");
  const canReconcile = mayReconcile && status === "in_doubt";

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canSend && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call("/execute")}
            data-testid="refund-execute"
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-contrast disabled:opacity-50"
          >
            Send refund
          </button>
        )}
        {canResolve && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void call("/resolve")}
            data-testid="refund-resolve"
            className="rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Ask the provider
          </button>
        )}
        {canReconcile && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setProposing((v) => !v)}
            data-testid="refund-reconcile-open"
            className="rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Reconcile by hand
          </button>
        )}
      </div>

      {proposing && canReconcile && (
        <div className="rounded border border-border p-2 text-xs" data-testid="reconcile-form">
          <label className="block">
            <span className="text-muted">What the provider&apos;s records say</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as "succeeded" | "failed")}
              data-testid="reconcile-outcome"
              className="mt-1 w-full rounded border border-border bg-surface-muted px-2 py-1"
            >
              <option value="failed">No refund exists</option>
              <option value="succeeded">The refund was made</option>
            </select>
          </label>
          {/* Required to claim a success, and the route refuses without it. */}
          <label className="mt-2 block">
            <span className="text-muted">Provider reference</span>
            <input
              value={providerRef}
              onChange={(e) => setProviderRef(e.target.value)}
              data-testid="reconcile-ref"
              className="mt-1 w-full rounded border border-border bg-surface-muted px-2 py-1 font-mono"
            />
          </label>
          <label className="mt-2 block">
            <span className="text-muted">Where you read it</span>
            <input
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              data-testid="reconcile-evidence"
              className="mt-1 w-full rounded border border-border bg-surface-muted px-2 py-1"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void call("/reconcile", {
                  action: "propose",
                  outcome,
                  providerRefundRef: providerRef,
                  evidence,
                })
              }
              data-testid="reconcile-propose"
              className="rounded border border-border px-3 py-1.5 font-medium disabled:opacity-50"
            >
              Propose
            </button>
            {/* Confirming is a second person's action. The button exists for
                whoever that is; the domain refuses the proposer. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => void call("/reconcile", { action: "confirm" })}
              data-testid="reconcile-confirm"
              className="rounded border border-border px-3 py-1.5 font-medium disabled:opacity-50"
            >
              Confirm someone else&apos;s proposal
            </button>
          </div>
        </div>
      )}

      {message !== null && (
        <p className="font-mono text-xs text-muted" data-testid="refund-message">
          {message}
        </p>
      )}
    </div>
  );
}
