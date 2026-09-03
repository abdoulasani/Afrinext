"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import Link from "next/link";
import { Button, inputClass } from "@afrinext/ui";
import {
  acceptAccountConsent, chooseProgramme, requestEmailVerification, signInWithEmail,
  signUpWithEmail, type OutstandingDoc,
} from "@/lib/auth-client";
import { ProgrammeChoice, type ProgrammeOption } from "./ProgrammeChoice";

export type SignUpLabels = {
  programmeTitle: string;
  programmeIntro: string;
  notPaid: string;
  paymentUnavailable: string;
  name: string;
  email: string;
  password: string;
  passwordHint: string;
  createAccount: string;
  continue: string;
  back: string;
  generic: string;
  haveAccount: string;
  signIn: string;
  addressTaken: string;
  consentTitle: string;
  consentExplain: string;
  consentRequired: string;
  acceptAll: string;
  localeLabel: string;
  documentNames: Readonly<Record<string, string>>;
};

/**
 * Signup: programme, then credentials, then consent.
 *
 * The order matters and is not cosmetic. Asking which programme somebody wants
 * BEFORE asking for an email address is what makes the answer available at
 * account creation without ever letting it stand for a payment — the choice is
 * recorded on the account as an intent the moment the account exists, and the
 * subscription it implies is written as `pending_payment`, which grants nothing.
 *
 * Consent is last because it is the gate. The account is provisioned as
 * `pending_consent` and resolves to NO actor until the terms are accepted; this
 * step is how it stops being that, and skipping it leaves an account that can
 * hold a session and do nothing with it.
 *
 * Email verification is NOT in this flow. It is a trust signal, not a gate, and
 * the person reaches their dashboard without it — a code is sent, and the
 * banner offers the rest whenever they want it.
 */
export default function SignUpForm({
  locale, labels, programmes,
}: {
  locale: string;
  labels: SignUpLabels;
  programmes: readonly ProgrammeOption[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<"programme" | "account" | "consent">("programme");
  const [programme, setProgramme] = useState<ProgrammeOption["value"]>("vendeur");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [outstanding, setOutstanding] = useState<readonly OutstandingDoc[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createAccount(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signUpWithEmail({ email, password, name });
      if (result.error) {
        setError(result.error.message ?? labels.generic);
        return;
      }

      /*
       * Sign in explicitly, and treat a failure here as "that address is
       * taken".
       *
       * `autoSignIn` is off — consent has not been given yet, so a session
       * handed out by signup would be a session for an account that cannot use
       * it — which means signup alone never leaves a session behind and this
       * step is required, not optional.
       *
       * It doubles as the duplicate check. Better Auth answers a signup on an
       * existing address with a success that creates nothing and issues no
       * token, so the only way to tell the two apart from here is to try the
       * credentials: they work for the account just created, and they do not
       * work for somebody else's. A signup form telling you an address is
       * taken IS an enumeration surface, and an unavoidable one — a form that
       * silently accepted a duplicate would be broken instead. The endpoints
       * that DO have a choice, reset and verification, are the ones that
       * answer identically for every address.
       */
      const session = await signInWithEmail({ email, password });
      if (session.error) {
        // A 429 here means the server asked us to wait, not that the address is
        // taken. Saying "taken" would send somebody to recover an account that
        // does not exist.
        setError(
          session.error.status === 429
            ? (session.error.message ?? labels.generic)
            : labels.addressTaken,
        );
        return;
      }

      /*
       * The programme is recorded now, on the account that has just been
       * created. It is a separate request rather than a signup field because
       * it is a separate thing: Better Auth owns the credential, Afrinext owns
       * the programme, and a failure here must not cost somebody their account.
       */
      const chosen = await chooseProgramme(programme);
      if (!chosen.ok) setError(chosen.message ?? labels.generic);

      // Sent, not waited on. Verification blocks nothing.
      void requestEmailVerification();

      const consent = await fetch("/api/v1/consent/account", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const body = (await consent.json().catch(() => null)) as
        | { data?: { outstanding?: OutstandingDoc[] } }
        | null;
      setOutstanding(body?.data?.outstanding ?? []);
      setStep("consent");
    } catch {
      setError(labels.generic);
    } finally {
      setBusy(false);
    }
  }

  async function accept(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await acceptAccountConsent();
      if (result.error) {
        const message = result.error.message;
        setError(message !== undefined && message !== "" ? message : labels.generic);
      } else {
        router.push(`/${locale}` as Route);
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
        step === "programme"
          ? (e) => { e.preventDefault(); setStep("account"); }
          : step === "account" ? createAccount : accept
      }
      className="flex flex-col gap-5 px-4 pt-8 sm:px-6"
      data-testid={`signup-step-${step}`}
    >
      {error !== null && (
        <p
          role="alert"
          data-testid="signup-error"
          className="rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-2.5 text-small font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      {step === "programme" && (
        <ProgrammeChoice
          options={programmes}
          value={programme}
          onChange={setProgramme}
          notPaid={labels.notPaid}
          paymentUnavailable={labels.paymentUnavailable}
          title={labels.programmeTitle}
          intro={labels.programmeIntro}
        />
      )}

      {step === "account" && (
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="text-small font-medium text-foreground">{labels.name}</span>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              autoComplete="name"
              className={`mt-1.5 ${inputClass}`}
              required
            />
          </label>
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
              autoComplete="new-password"
              /*
               * The minimum is stated, and it is also enforced server-side by
               * Better Auth and by the reset path. A `minLength` a person can
               * delete from the DOM is a courtesy, never the control.
               */
              minLength={10}
              className={`mt-1.5 ${inputClass}`}
              required
            />
            <span className="mt-1.5 block text-caption text-muted">{labels.passwordHint}</span>
          </label>
        </div>
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
                <p className="mt-0.5 text-caption tabular-nums text-muted">
                  v{doc.version} · {labels.localeLabel}: {doc.locale}
                </p>
              </li>
            ))}
          </ul>

          <label className="flex items-start gap-3 py-1 text-small text-foreground">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => { setAgreed(e.target.checked); }}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--copper)]"
              required
            />
            <span>{labels.consentRequired}</span>
          </label>
        </section>
      )}

      <Button
        type="submit"
        variant="solid"
        size="lg"
        loading={busy}
        disabled={step === "consent" && !agreed}
        data-testid={step === "consent" ? "signup-consent-accept" : "signup-continue"}
        className="w-full"
      >
        {step === "account" ? labels.createAccount
          : step === "consent" ? labels.acceptAll
          : labels.continue}
      </Button>

      {step === "account" && (
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => { setStep("programme"); setError(null); }}
          className="w-full"
        >
          {labels.back}
        </Button>
      )}

      {step !== "consent" && (
        <p className="text-center text-small text-muted">
          {labels.haveAccount}{" "}
          <Link
            href={`/${locale}/sign-in` as Route}
            className="font-semibold text-copper underline underline-offset-2"
          >
            {labels.signIn}
          </Link>
        </p>
      )}
    </form>
  );
}
