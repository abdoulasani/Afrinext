import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { auth as core } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { PageIntro } from "@/components/PageIntro";
import { Shell } from "@/components/Shell";
import VerifyEmailForm from "@/components/VerifyEmailForm";
import { sessionIdentity } from "@/lib/email-auth";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const identity = await sessionIdentity();
  if (identity === undefined) redirect(`/${locale}/sign-in` as Route);

  /*
   * Nothing to do here for an account that is already verified, or for a phone
   * account whose address was invented by signup and can receive nothing.
   * Showing a code field for either would be a screen that cannot succeed.
   */
  if (identity.emailVerified || !core.isReachableEmail(identity.email)) {
    redirect(`/${locale}` as Route);
  }

  /*
   * Whether a code is actually outstanding, asked rather than assumed.
   *
   * This screen used to open with "Nous avons envoyé un code à X" on every
   * render — a claim about something that happened on another screen, which
   * this page had no way to know about and would have been wrong about after a
   * refused send. It is a state, so it is read.
   *
   * The page still sends nothing on load. An automatic send here would spend a
   * code every time somebody re-read the screen, and the cooldown would then
   * refuse the resend they actually meant to make.
   */
  const pending = await core.hasLiveChallenge(getDb(), {
    kind: "email",
    identifier: identity.email,
    purpose: "email_verification",
  });

  return (
    <>
      <PageIntro title={translate(locale, "auth.verifyTitle")} />
      <Shell width="narrow">
        <VerifyEmailForm
          locale={locale}
          email={identity.email}
          pending={pending}
          labels={{
            intro: translate(locale, "auth.verifyIntro", { email: "{email}" }),
            noPending: translate(locale, "auth.verifyNoPending"),
            sent: translate(locale, "auth.verifySent"),
            retryIn: translate(locale, "auth.retryInSeconds", { seconds: "{seconds}" }),
            code: translate(locale, "auth.codeLabel"),
            submit: translate(locale, "auth.verifySubmit"),
            resend: translate(locale, "auth.verifyResend"),
            done: translate(locale, "auth.verifyDone"),
            notBlocking: translate(locale, "auth.verifyNotBlocking"),
            later: translate(locale, "auth.verifyLater"),
            generic: translate(locale, "error.generic"),
            otpInvalid: translate(locale, "auth.otpInvalid"),
          }}
        />
      </Shell>
    </>
  );
}
