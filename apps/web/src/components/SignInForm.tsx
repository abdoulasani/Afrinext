"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import Link from "next/link";
import { Button, inputClass } from "@afrinext/ui";
import {
  acceptAccountConsent, sendPhoneOtp, signInWithEmail, verifyPhoneOtp,
  type OutstandingDoc,
} from "@/lib/auth-client";

type Labels = {
  phone: string;
  code: string;
  continue: string;
  back: string;
  generic: string;
  email: string;
  password: string;
  signIn: string;
  invalidCredentials: string;
  tooManyRequests: string;
  forgotPassword: string;
  usePhone: string;
  useEmail: string;
  noAccount: string;
  createAccount: string;
  consentTitle: string;
  consentExplain: string;
  consentRequired: string;
  acceptAll: string;
  localeLabel: string;
  documentNames: Readonly<Record<string, string>>;
};

/**
 * Sign-in: email and password first, phone still there.
 *
 * Email became the main path because that is where new accounts now come from,
 * but the phone flow is not a legacy branch kept out of politeness — it is how
 * every account created before this milestone signs in, and those accounts have
 * no password at all. Removing it would lock out real people with real stores,
 * real orders and real ledger balances. It stays until every one of them has an
 * address, and the switch is one tap away rather than buried.
 *
 * Rate limiting lives on the server — a client-side cooldown is a courtesy,
 * never a control — so a refusal comes back as an error with the wait time.
 */
export default function SignInForm({ locale, labels }: { locale: string; labels: Labels }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "phone" | "code" | "consent">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [outstanding, setOutstanding] = useState<readonly OutstandingDoc[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithEmail({ email, password });
      if (result.error) {
        /*
         * One message for a wrong password and for an address with no account.
         * Better Auth already answers both the same way; this keeps the screen
         * from re-introducing the difference in the words it shows.
         *
         * A rate limit is NOT one of those two and must not be dressed as one:
         * telling somebody their password is wrong when the server is asking
         * them to wait sends them to change a password that was correct.
         */
        setError(
          result.error.status === 429
            ? (result.error.message ?? labels.tooManyRequests)
            : labels.invalidCredentials,
        );
        return;
      }
      await afterSession();
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Where a fresh session lands.
   *
   * A `pending_consent` account holds a session and resolves to no actor, so
   * the outstanding documents are asked for before going anywhere. That is the
   * same gate the phone path meets, reached from the other direction.
   */
  async function afterSession(): Promise<void> {
    const response = await fetch("/api/v1/consent/account", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | { data?: { outstanding?: OutstandingDoc[] } }
      | null;
    const pending = body?.data?.outstanding ?? [];
    if (pending.length > 0) {
      setOutstanding(pending);
      setStep("consent");
      return;
    }
    // Client-side navigation: a full page load would drop the freshly set
    // session cookie state the router already knows about.
    router.push(`/${locale}` as Route);
    router.refresh();
  }

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
          step === "email" ? signIn
        : step === "phone" ? requestCode
        : step === "code" ? verifyCode
        : acceptConsent
      }
      className="flex flex-col gap-5 px-4 pt-8 sm:px-6"
      data-testid={`signin-step-${step}`}
    >
      {error !== null && (
        <p
          role="alert"
          data-testid="signin-error"
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

      {step === "email" ? (
        <div className="flex flex-col gap-4">
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
              className={`mt-1.5 ${inputClass}`}
              required
            />
          </label>
          <label className="block">
            <span className="text-small font-medium text-foreground">{labels.password}</span>
            <input
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
              type="password"
              autoComplete="current-password"
              className={`mt-1.5 ${inputClass}`}
              required
            />
          </label>
          <Link
            href={`/${locale}/password-reset` as Route}
            className="self-start text-small font-medium text-copper underline underline-offset-2"
          >
            {labels.forgotPassword}
          </Link>
        </div>
      ) : step === "phone" ? (
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
        {step === "consent" ? labels.acceptAll
          : step === "email" ? labels.signIn
          : labels.continue}
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

      {(step === "email" || step === "phone") && (
        <>
          {/* The other credential, one tap away. Existing phone accounts have
              no password, so this is not an alternative for them — it is the
              only way in, and it must not read as a fallback. */}
          <Button
            type="button"
            variant="ghost"
            size="md"
            data-testid={step === "email" ? "signin-use-phone" : "signin-use-email"}
            onClick={() => { setStep(step === "email" ? "phone" : "email"); setError(null); }}
            className="w-full"
          >
            {step === "email" ? labels.usePhone : labels.useEmail}
          </Button>

          <p className="text-center text-small text-muted">
            {labels.noAccount}{" "}
            <Link
              href={`/${locale}/sign-up` as Route}
              className="font-semibold text-copper underline underline-offset-2"
            >
              {labels.createAccount}
            </Link>
          </p>
        </>
      )}
    </form>
  );
}
