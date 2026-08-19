"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { sendPhoneOtp, verifyPhoneOtp } from "@/lib/auth-client";

type Labels = {
  phone: string;
  code: string;
  continue: string;
  back: string;
  generic: string;
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
  const [step, setStep] = useState<"phone" | "code">("phone");
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

  const input =
    "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-primary";

  return (
    <form onSubmit={step === "phone" ? requestCode : verifyCode} className="space-y-4 px-4 py-6">
      {error !== null && (
        <p role="alert" className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
          {error}
        </p>
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
      ) : (
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
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-contrast disabled:opacity-60"
      >
        {labels.continue}
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
