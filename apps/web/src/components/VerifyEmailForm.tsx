"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { Button, inputClass } from "@afrinext/ui";
import { confirmEmailVerification, requestEmailVerification } from "@/lib/auth-client";

export type VerifyLabels = {
  intro: string;
  code: string;
  submit: string;
  resend: string;
  done: string;
  notBlocking: string;
  later: string;
  generic: string;
  otpInvalid: string;
};

/**
 * The verification screen, which nothing forces anybody onto.
 *
 * "Plus tard" is a real link back to the app, not a nag that reopens: the whole
 * point of keeping verification out of the consent gate is that a person can
 * decline it and keep working. A screen that trapped them here would put the
 * decision back where the architecture took it out of.
 */
export default function VerifyEmailForm({
  locale, email, labels,
}: {
  locale: string;
  email: string;
  labels: VerifyLabels;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await confirmEmailVerification(code);
      if (!result.ok) {
        // One message for wrong, expired, exhausted and never-issued. The
        // endpoint does not distinguish them, and neither does this.
        setError(result.code === "auth.otp_invalid" ? labels.otpInvalid : (result.message ?? labels.generic));
        return;
      }
      /*
       * Deliberately no `router.refresh()` here.
       *
       * This page redirects an already-verified account to the home screen, so
       * refreshing on success re-runs that server component, it sees the flag
       * we have just set, and the person is bounced away before they can read
       * the confirmation — landing on the home screen with no idea whether it
       * worked. The button below does the navigation, and refreshes then, which
       * is what clears the banner.
       */
      setDone(true);
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestEmailVerification();
      if (!result.ok) setError(result.message ?? labels.generic);
      else setNotice(labels.intro.replace("{email}", email));
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-5 px-4 pt-8 sm:px-6">
        <p
          role="status"
          data-testid="verify-done"
          className="rounded-[var(--radius-md)] border border-[var(--success)]/25 bg-[var(--success-soft)] px-3.5 py-3 text-small font-medium text-[var(--success)]"
        >
          {labels.done}
        </p>
        <Button
          type="button"
          variant="solid"
          size="lg"
          className="w-full"
          onClick={() => { router.push(`/${locale}` as Route); router.refresh(); }}
        >
          {labels.later}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 px-4 pt-8 sm:px-6"
      data-testid="verify-email-form"
    >
      <p className="text-small text-muted">{labels.intro.replace("{email}", email)}</p>

      {error !== null && (
        <p
          role="alert"
          data-testid="verify-error"
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" className="rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-2.5 text-small text-muted">
          {notice}
        </p>
      )}

      <label className="block">
        <span className="text-small font-medium text-foreground">{labels.code}</span>
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className={`mt-1.5 text-center text-h2 tabular-nums tracking-[0.35em] ${inputClass}`}
          required
        />
      </label>

      <Button type="submit" variant="solid" size="lg" loading={busy} className="w-full">
        {labels.submit}
      </Button>

      <Button type="button" variant="ghost" size="md" onClick={resend} className="w-full">
        {labels.resend}
      </Button>

      {/* The honest exit. Verification blocks nothing, and this says so. */}
      <p className="text-center text-small text-muted">{labels.notBlocking}</p>
      <Button
        type="button"
        variant="ghost"
        size="md"
        className="w-full"
        onClick={() => { router.push(`/${locale}` as Route); }}
      >
        {labels.later}
      </Button>
    </form>
  );
}
