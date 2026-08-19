import { notFound } from "next/navigation";
import { isLocale, translate } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
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
      <AppHeader title={translate(locale, "auth.signIn")} />
      <SignInForm
        locale={locale}
        labels={{
          phone: translate(locale, "auth.phoneLabel"),
          code: translate(locale, "auth.codeLabel"),
          continue: translate(locale, "common.continue"),
          back: translate(locale, "common.back"),
          generic: translate(locale, "error.generic"),
        }}
      />
    </>
  );
}
