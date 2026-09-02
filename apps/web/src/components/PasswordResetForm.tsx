"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { Button, inputClass } from "@afrinext/ui";
import { requestPasswordReset, resetPassword } from "@/lib/auth-client";

export type ResetLabels = {
  intro: string;
  email: string;
  sendCode: string;
  sent: string;
  code: string;
  newPassword: string;
  passwordHint: string;
  submit: string;
  done: string;
  back: string;
  generic: string;
  otpInvalid: string;
  passwordTooShort: string;
  signIn: string;
};

/**
 * Forgotten password, in two steps on one screen.
 *
 * The first step ALWAYS says the same thing: "if an account uses this address,
 * a code has been sent". Not "we sent you a code", which would be a lie for an
 * unknown address, and not "no account found", which would hand an attacker a
 * customer list one address at a time. The screen then moves straight to the
 * code field either way, because a form that only advanced for real addresses
 * would leak exactly what the message refuses to.
 */
export default function PasswordResetForm({
  locale, labels,
}: {
  locale: string;
  labels: ResetLabels;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        // The only refusal that reaches here is the rate limit, which says
        // nothing about whether the address exists.
        setError(result.message ?? labels.generic);
        return;
      }
      setNotice(labels.sent);
      setStep("reset");
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await resetPassword({ email, code, password });
      if (!result.ok) {
        setError(
          result.code === "auth.password_too_short"
            ? labels.passwordTooShort
            : result.code === "auth.otp_invalid"
              ? labels.otpInvalid
              : (result.message ?? labels.generic),
        );
        return;
      }
      setNotice(null);
      setStep("done");
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex flex-col gap-5 px-4 pt-8 sm:px-6">
        <p
          role="status"
          data-testid="reset-done"
          className="rounded-[var(--radius-md)] border border-[var(--success)]/25 bg-[var(--success-soft)] px-3.5 py-3 text-small font-medium text-[var(--success)]"
        >
          {/* Says the sessions were closed, because that is what happened and
              a person who was signed in elsewhere deserves to know why. */}
          {labels.done}
        </p>
        <Button
          type="button"
          variant="solid"
          size="lg"
          className="w-full"
          onClick={() => {
            router.push(`/${locale}/sign-in` as Route);
            router.refresh();
          }}
        >
          {labels.signIn}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={step === "request" ? request : submit}
      className="flex flex-col gap-5 px-4 pt-8 sm:px-6"
      data-testid={`reset-step-${step}`}
    >
      <p className="text-small text-muted">{labels.intro}</p>

      {error !== null && (
        <p
          role="alert"
          data-testid="reset-error"
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p
          role="status"
          data-testid="reset-sent"
          className="rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-2.5 text-small text-muted"
        >
          {notice}
        </p>
      )}

      <label className="block">
        <span className="text-small font-medium text-foreground">{labels.email}</span>
        <input
          value={email}
          onChange={(e) => { setEmail(e.target.value); }}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={step === "reset"}
          className={`mt-1.5 ${inputClass} ${step === "reset" ? "bg-surface-muted" : ""}`}
          required
        />
      </label>

      {step === "reset" && (
        <>
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
          <label className="block">
            <span className="text-small font-medium text-foreground">{labels.newPassword}</span>
            <input
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
              type="password"
              autoComplete="new-password"
              minLength={10}
              className={`mt-1.5 ${inputClass}`}
              required
            />
            <span className="mt-1.5 block text-caption text-muted">{labels.passwordHint}</span>
          </label>
        </>
      )}

      <Button
        type="submit"
        variant="solid"
        size="lg"
        loading={busy}
        data-testid="reset-continue"
        className="w-full"
      >
        {step === "request" ? labels.sendCode : labels.submit}
      </Button>

      {step === "reset" && (
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="w-full"
          onClick={() => { setStep("request"); setNotice(null); setError(null); }}
        >
          {labels.back}
        </Button>
      )}
    </form>
  );
}
