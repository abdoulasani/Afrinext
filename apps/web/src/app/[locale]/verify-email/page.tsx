import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { auth as core } from "@afrinext/core";
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

  return (
    <>
      <PageIntro title={translate(locale, "auth.verifyTitle")} />
      <Shell width="narrow">
        <VerifyEmailForm
          locale={locale}
          email={identity.email}
          labels={{
            intro: translate(locale, "auth.verifyIntro", { email: "{email}" }),
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
