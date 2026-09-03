import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { money as m, programme as programmes } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { PageIntro } from "@/components/PageIntro";
import { Shell } from "@/components/Shell";
import SignUpForm from "@/components/SignUpForm";
import type { ProgrammeOption } from "@/components/ProgrammeChoice";
import { currencyRegistry } from "@/lib/catalog";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Somebody already signed in has no business on a signup form.
  if ((await currentActor()) !== undefined) redirect(`/${locale}` as Route);

  /*
   * The price is read, not written into the page. It lives in
   * `platform_settings` with a reviewed default, and it is rendered through
   * the currency registry so the minor-unit exponent comes from the table —
   * XOF has zero decimals, and a page that divided by 100 would show 20 FCFA.
   */
  const price = await programmes.loadProgrammePrice(getDb());
  const registry = await currencyRegistry();

  const options: ProgrammeOption[] = [
    {
      value: "vendeur",
      name: translate(locale, "programme.vendeur"),
      price: translate(locale, "programme.vendeurPrice"),
      pitch: translate(locale, "programme.vendeurPitch"),
    },
    {
      value: "entrepreneur",
      name: translate(locale, "programme.entrepreneur"),
      price: translate(locale, "programme.entrepreneurPrice", {
        price: m.formatMoney(price.price, registry),
      }),
      pitch: translate(locale, "programme.entrepreneurPitch"),
    },
  ];

  return (
    <>
      <PageIntro title={translate(locale, "auth.signUpTitle")} />
      <Shell width="narrow">
        <SignUpForm
          locale={locale}
          programmes={options}
          labels={{
            programmeTitle: translate(locale, "programme.title"),
            programmeIntro: translate(locale, "programme.intro"),
            notPaid: translate(locale, "programme.notPaid"),
            paymentUnavailable: translate(locale, "programme.paymentUnavailable"),
            name: translate(locale, "auth.nameLabel"),
            email: translate(locale, "auth.emailLabel"),
            password: translate(locale, "auth.passwordLabel"),
            passwordHint: translate(locale, "auth.passwordHint", { count: 10 }),
            createAccount: translate(locale, "auth.createAccount"),
            continue: translate(locale, "common.continue"),
            back: translate(locale, "common.back"),
            generic: translate(locale, "error.generic"),
            haveAccount: translate(locale, "auth.haveAccount"),
            signIn: translate(locale, "auth.signIn"),
            addressTaken: translate(locale, "auth.addressTaken"),
            consentTitle: translate(locale, "signup.consentTitle"),
            consentExplain: translate(locale, "signup.consentExplain"),
            consentRequired: translate(locale, "signup.consentRequired"),
            acceptAll: translate(locale, "signup.acceptAll"),
            localeLabel: translate(locale, "signup.locale"),
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
