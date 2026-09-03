"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@afrinext/ui";
import { chooseProgramme } from "@/lib/auth-client";
import { ProgrammeChoice, type ProgrammeOption } from "./ProgrammeChoice";

/**
 * Changing programme after signup, which is the whole reason the choice is a
 * column on `users` and not a property of the account's creation.
 *
 * A Vendeur who becomes an Entrepreneur keeps the same `users.id`, so their
 * roles, their store, their orders, their wallet and every ledger entry ever
 * posted against them follow them across. There is no path here — and there
 * must never be one — that asks somebody to open a second account.
 */
export default function ProgrammeSettings({
  options, current, status, labels,
}: {
  options: readonly ProgrammeOption[];
  current: ProgrammeOption["value"];
  status: string;
  labels: {
    title: string;
    intro: string;
    notPaid: string;
    paymentUnavailable: string;
    submit: string;
    generic: string;
    statusLabel: string;
  };
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-col gap-5 px-4 pt-8 sm:px-6"
      data-testid="programme-settings"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        void chooseProgramme(choice)
          .then((result) => {
            if (!result.ok) setError(result.message ?? labels.generic);
            else router.refresh();
          })
          .catch(() => { setError(labels.generic); })
          .finally(() => { setBusy(false); });
      }}
    >
      {error !== null && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      {/* The subscription's real state, named. Never "actif" for something
          nobody has paid for. */}
      <p
        data-testid="programme-status"
        className="rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-2.5 text-small text-muted"
      >
        {labels.statusLabel}: <span className="font-semibold text-foreground">{status}</span>
      </p>

      <ProgrammeChoice
        options={options}
        value={choice}
        onChange={setChoice}
        notPaid={labels.notPaid}
        paymentUnavailable={labels.paymentUnavailable}
        title={labels.title}
        intro={labels.intro}
      />

      <Button
        type="submit"
        variant="solid"
        size="lg"
        loading={busy}
        disabled={choice === current}
        data-testid="programme-save"
        className="w-full"
      >
        {labels.submit}
      </Button>
    </form>
  );
}
