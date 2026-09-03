import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { money as m, programme as programmes } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate } from "@afrinext/i18n";
import { PageIntro } from "@/components/PageIntro";
import { Shell } from "@/components/Shell";
import ProgrammeSettings from "@/components/ProgrammeSettings";
import type { ProgrammeOption } from "@/components/ProgrammeChoice";
import { currencyRegistry } from "@/lib/catalog";
import { sessionIdentity } from "@/lib/email-auth";

export const dynamic = "force-dynamic";

export default async function ProgrammePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const identity = await sessionIdentity();
  if (identity === undefined) redirect(`/${locale}/sign-in` as Route);

  const state = await programmes.programmeState(getDb(), identity.userId);
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

  /*
   * The status shown is the SUBSCRIPTION's, not the programme's. Somebody who
   * chose Entrepreneur and paid nothing reads "En attente de paiement" here,
   * which is the truth; "Entrepreneur" alone would read as a subscription that
   * is running.
   */
  const status = translate(
    locale,
    state.subscription === null
      ? "programme.status.none"
      : "programme.status.pending_payment",
  );

  return (
    <>
      <PageIntro
        eyebrow={translate(locale, "menu.account")}
        title={translate(locale, "programme.title")}
      />
      <Shell width="narrow">
        <ProgrammeSettings
          options={options}
          current={state.chosen}
          status={status}
          labels={{
            title: translate(locale, "programme.title"),
            intro: translate(locale, "programme.intro"),
            notPaid: translate(locale, "programme.notPaid"),
            paymentUnavailable: translate(locale, "programme.paymentUnavailable"),
            submit: translate(locale, "programme.change"),
            generic: translate(locale, "error.generic"),
            statusLabel: translate(locale, "programme.selected"),
          }}
        />
      </Shell>
    </>
  );
}
