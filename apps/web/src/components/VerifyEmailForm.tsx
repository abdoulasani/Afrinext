"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { Button, inputClass } from "@afrinext/ui";
import { confirmEmailVerification, requestEmailVerification } from "@/lib/auth-client";

export type VerifyLabels = {
  intro: string;
  noPending: string;
  sent: string;
  retryIn: string;
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
 *
 * ---------------------------------------------------------------------------
 * What it says, and why it is careful about it
 * ---------------------------------------------------------------------------
 *
 * `pending` comes from the server, which asked the database whether a live
 * challenge exists for this address. The screen used to open with "we sent you
 * a code" unconditionally — a claim about an event on another screen, which it
 * could not know had happened and would have been wrong about after a refused
 * send. Now it reports a state it was told, and the only thing that sends is
 * the button somebody presses.
 */
export default function VerifyEmailForm({
  locale, email, pending, labels,
}: {
  locale: string;
  email: string;
  /** True when the server found an unconsumed, unexpired code for this address. */
  pending: boolean;
  labels: VerifyLabels;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [sentNow, setSentNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Milliseconds the server told us to wait, counted down to zero. */
  const [waitMs, setWaitMs] = useState(0);

  /*
   * The countdown.
   *
   * A timer, not a re-render loop: the interval writes the remaining time and
   * clears itself at zero, so a screen left open costs one tick a second and
   * stops on its own. `Date.now()` rather than decrementing a counter, because
   * a backgrounded mobile tab does not get its intervals on time and a
   * decremented counter would drift into telling somebody to keep waiting long
   * after the server had stopped refusing.
   */
  useEffect(() => {
    if (waitMs <= 0) return undefined;
    const endsAt = Date.now() + waitMs;
    const tick = setInterval(() => {
      setWaitMs(Math.max(0, endsAt - Date.now()));
    }, 250);
    return () => { clearInterval(tick); };
    // Deliberately keyed on nothing but the arrival of a new wait: re-running
    // this on every tick would restart the window from the current remainder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitMs > 0]);

  const waitSeconds = Math.ceil(waitMs / 1000);
  const cooling = waitMs > 0;

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
    try {
      const result = await requestEmailVerification();
      if (result.ok) {
        setSentNow(true);
        return;
      }
      /*
       * A refusal now carries its wait, so the screen can say how long instead
       * of "réessayez plus tard" — which told somebody to guess, and guessing
       * means pressing the button again.
       */
      if (result.retryAfterMs !== undefined) {
        setWaitMs(result.retryAfterMs);
        setError(null);
      } else {
        setError(result.message ?? labels.generic);
      }
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
      data-pending={pending || sentNow}
    >
      <p className="text-small text-muted" data-testid="verify-intro">
        {labels.intro.replace("{email}", email)}
      </p>

      {/* The state, not a claim about an action this screen did not perform. */}
      {!pending && !sentNow && (
        <p
          data-testid="verify-no-pending"
          className="rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-2.5 text-small text-muted"
        >
          {labels.noPending}
        </p>
      )}
      {sentNow && (
        <p
          role="status"
          data-testid="verify-sent"
          className="rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-2.5 text-small text-muted"
        >
          {labels.sent}
        </p>
      )}

      {error !== null && (
        <p
          role="alert"
          data-testid="verify-error"
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]"
        >
          {error}
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

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={resend}
          disabled={cooling || busy}
          data-testid="verify-resend"
          className="w-full"
        >
          {labels.resend}
        </Button>
        {cooling && (
          /*
           * `aria-live="polite"` and not `assertive`: a screen reader should
           * hear the wait once it settles, not be interrupted four times a
           * second. The button's own `disabled` is what actually stops the
           * press; this is the explanation for it.
           */
          <p
            aria-live="polite"
            data-testid="verify-cooldown"
            className="text-center text-caption tabular-nums text-muted"
          >
            {labels.retryIn.replace("{seconds}", String(waitSeconds))}
          </p>
        )}
      </div>

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
