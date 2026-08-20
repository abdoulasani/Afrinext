"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
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

  const input =
    "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-primary";

  return (
    <form
      onSubmit={
        step === "phone" ? requestCode : step === "code" ? verifyCode : acceptConsent
      }
      className="space-y-4 px-4 py-6"
    >
      {error !== null && (
        <p role="alert" className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
          {error}
        </p>
      )}

      {step === "consent" && (
        <section data-testid="signup-consent" className="space-y-3">
          <h2 className="text-sm font-semibold">{labels.consentTitle}</h2>
          <p className="text-sm text-muted">{labels.consentExplain}</p>

          <ul className="space-y-2">
            {outstanding.map((doc) => (
              <li key={doc.kind} className="rounded-xl bg-surface-muted px-3 py-2">
                <p className="text-sm font-medium">
                  {labels.documentNames[doc.kind] ?? doc.kind}
                </p>
                {/* The exact version and locale being agreed to, on screen.
                    Naming them is the difference between an acceptance and a
                    gesture. */}
                <p className="font-mono text-xs text-muted">
                  v{doc.version} · {labels.localeLabel}: {doc.locale}
                </p>
              </li>
            ))}
          </ul>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="agree"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
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
          <span className="text-xs font-medium text-muted">{labels.phone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+227 90 00 00 01"
            className={`mt-1 ${input}`}
            required
          />
        </label>
      ) : step === "code" ? (
        <label className="block">
          <span className="text-xs font-medium text-muted">{labels.code}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className={`mt-1 tracking-[0.4em] ${input}`}
            required
          />
        </label>
      ) : null}

      <button
        type="submit"
        disabled={busy || (step === "consent" && !agreed)}
        data-testid={step === "consent" ? "signup-consent-accept" : "signin-continue"}
        className="w-full rounded-2xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-contrast disabled:opacity-60"
      >
        {step === "consent" ? labels.acceptAll : labels.continue}
      </button>

      {step === "code" && (
        <button
          type="button"
          onClick={() => { setStep("phone"); setError(null); }}
          className="w-full text-center text-xs font-medium text-muted"
        >
          {labels.back}
        </button>
      )}
    </form>
  );
}
