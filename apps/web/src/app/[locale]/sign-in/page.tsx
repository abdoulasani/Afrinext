import { notFound } from "next/navigation";
import { isLocale, translate } from "@afrinext/i18n";
import { PageIntro } from "@/components/PageIntro";
import { Shell } from "@/components/Shell";
import SignInForm from "@/components/SignInForm";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <>
      <PageIntro title={translate(locale, "auth.signIn")} />
      <Shell width="narrow">
      <SignInForm
        locale={locale}
        labels={{
          phone: translate(locale, "auth.phoneLabel"),
          code: translate(locale, "auth.codeLabel"),
          continue: translate(locale, "common.continue"),
          back: translate(locale, "common.back"),
          generic: translate(locale, "error.generic"),
          consentTitle: translate(locale, "signup.consentTitle"),
          consentExplain: translate(locale, "signup.consentExplain"),
          consentRequired: translate(locale, "signup.consentRequired"),
          acceptAll: translate(locale, "signup.acceptAll"),
          localeLabel: translate(locale, "signup.locale"),
          // Document kinds are database values; these are what a person reads.
          documentNames: {
            terms_of_use: translate(locale, "signup.termsOfUse"),
            privacy_policy: translate(locale, "signup.privacyPolicy"),
          },
        }}
      />
      </Shell>
    </>
  );
}
