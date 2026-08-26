"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { Button, inputClass } from "@afrinext/ui";
import { acceptAccountConsent, sendPhoneOtp, verifyPhoneOtp, type OutstandingDoc } from "@/lib/auth-client";

type Labels = {
  phone: string;
  code: string;
  continue: string;
  back: string;
  generic: string;
  consentTitle: string;
  consentExplain: string;
  consentRequired: string;
  acceptAll: string;
  localeLabel: string;
  documentNames: Readonly<Record<string, string>>;
};

/**
 * Phone-first sign-in.
 *
 * Two steps: request a code, then verify it. Rate limiting lives on the server —
 * a client-side cooldown is a courtesy, never a control — so a refusal comes
 * back as an error the person can act on, with the wait time.
 */
export default function SignInForm({ locale, labels }: { locale: string; labels: Labels }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code" | "consent">("phone");
  const [outstanding, setOutstanding] = useState<readonly OutstandingDoc[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await sendPhoneOtp(phone);
      if (result.error) {
        setError(result.error.message ?? labels.generic);
      } else {
        setStep("code");
      }
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPhoneOtp(phone, code);
      if (result.error) {
        setError(result.error.message ?? labels.generic);
      } else if ((result.consentRequired ?? []).length > 0) {
        // The session exists and grants nothing: the account is
        // `pending_consent` and resolves to no actor. This step is how it
        // stops being that.
        setOutstanding(result.consentRequired ?? []);
        setStep("consent");
      } else {
        // Client-side navigation: a full page load would drop the freshly
        // set session cookie state the router already knows about.
        router.push(`/${locale}/wallet` as Route);
        router.refresh();
      }
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  async function acceptConsent(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await acceptAccountConsent();
      if (result.error) {
        const message = result.error.message;
        setError(message !== undefined && message !== "" ? message : labels.generic);
      } else {
        router.push(`/${locale}/wallet` as Route);
        router.refresh();
      }
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }


  return (
    <form
      onSubmit={
        step === "phone" ? requestCode : step === "code" ? verifyCode : acceptConsent
      }
      className="flex flex-col gap-5 px-4 pt-8 sm:px-6"
    >
      {error !== null && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      {step === "consent" && (
        <section data-testid="signup-consent" className="flex flex-col gap-3">
          <h2 className="text-h3 text-foreground">{labels.consentTitle}</h2>
          <p className="text-small text-muted">{labels.consentExplain}</p>

          <ul className="flex flex-col gap-2">
            {outstanding.map((doc) => (
              <li
                key={doc.kind}
                className="rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-3"
              >
                <p className="text-small font-semibold text-foreground">
                  {labels.documentNames[doc.kind] ?? doc.kind}
                </p>
                {/* The exact version and locale being agreed to, on screen.
                    Naming them is the difference between an acceptance and a
                    gesture. */}
                <p className="mt-0.5 text-caption tabular-nums text-muted">
                  v{doc.version} · {labels.localeLabel}: {doc.locale}
                </p>
              </li>
            ))}
          </ul>

          <label className="flex items-start gap-3 py-1 text-small text-foreground">
            <input
              type="checkbox"
              name="agree"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              /* 20px, and the label is the rest of the target: a 16px
                 checkbox is a miss waiting to happen on a phone. */
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--copper)]"
              required
            />
            {/* The checkbox is how a person expresses the choice. It is not
                what enforces it: the account resolves to no actor until the
                server has recorded the acceptance. */}
            <span>{labels.consentRequired}</span>
          </label>
        </section>
      )}

      {step === "phone" ? (
        <label className="block">
          <span className="text-small font-medium text-foreground">{labels.phone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+227 90 00 00 01"
            className={`mt-1.5 ${inputClass}`}
            required
          />
        </label>
      ) : step === "code" ? (
        <label className="block">
          <span className="text-small font-medium text-foreground">{labels.code}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            /* Wide tracking and centred: a six-digit code read off a screen
               and typed back is easier to check when the digits are apart. */
            className={`mt-1.5 text-center text-h2 tabular-nums tracking-[0.35em] ${inputClass}`}
            required
          />
        </label>
      ) : null}

      <Button
        type="submit"
        variant="solid"
        size="lg"
        loading={busy}
        disabled={step === "consent" && !agreed}
        data-testid={step === "consent" ? "signup-consent-accept" : "signin-continue"}
        className="w-full"
      >
        {step === "consent" ? labels.acceptAll : labels.continue}
      </Button>

      {step === "code" && (
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => { setStep("phone"); setError(null); }}
          className="w-full"
        >
          {labels.back}
        </Button>
      )}
    </form>
  );
}
