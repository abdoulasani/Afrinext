import { notFound } from "next/navigation";
import { isLocale, translate } from "@afrinext/i18n";
import { PageIntro } from "@/components/PageIntro";
import { Shell } from "@/components/Shell";
import PasswordResetForm from "@/components/PasswordResetForm";

export const dynamic = "force-dynamic";

export default async function PasswordResetPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <>
      <PageIntro title={translate(locale, "auth.resetTitle")} />
      <Shell width="narrow">
        <PasswordResetForm
          locale={locale}
          labels={{
            intro: translate(locale, "auth.resetIntro"),
            email: translate(locale, "auth.emailLabel"),
            sendCode: translate(locale, "auth.sendCode"),
            sent: translate(locale, "auth.resetSent"),
            code: translate(locale, "auth.resetCodeLabel"),
            newPassword: translate(locale, "auth.newPasswordLabel"),
            passwordHint: translate(locale, "auth.passwordHint", { count: 10 }),
            submit: translate(locale, "auth.resetSubmit"),
            done: translate(locale, "auth.resetDone"),
            back: translate(locale, "common.back"),
            generic: translate(locale, "error.generic"),
            otpInvalid: translate(locale, "auth.otpInvalid"),
            passwordTooShort: translate(locale, "auth.passwordTooShort", { count: 10 }),
            signIn: translate(locale, "auth.signIn"),
          }}
        />
      </Shell>
    </>
  );
}
