import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authz, catalog } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate, type MessageKey } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import { Shell } from "@/components/Shell";
import StoreWizard from "@/components/StoreWizard";
import { createStoreAction } from "@/lib/catalog-actions";
import { supportedCountries } from "@/lib/catalog";
import { copyFor } from "@/lib/store-presentation";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The brand swatches, named for the material each colour comes from. */
const BRAND_LABELS: Readonly<Record<string, string>> = {
  laterite: "Latérite", indigo: "Indigo", forest: "Forêt",
  ochre: "Ocre", aubergine: "Aubergine", sable: "Sable",
};

export default async function NewStorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Opening a store requires an account. The wizard never renders for a
  // stranger, and `createStore` refuses one regardless.
  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  /*
   * And it requires the permission. This is presentation — `createStore`
   * checks again, and is the check that counts — but sending somebody through
   * four screens only to refuse them at the end is its own kind of dishonesty.
   */
  if (!(await authz.can(getDb(), actor, "store.create"))) {
    redirect(`/${locale}/sell` as Route);
  }

  const countries = await supportedCountries(locale);

  const labelFor = (key: string): string =>
    translate(locale, `create.${key}` as MessageKey);

  const labels: Record<string, string> = {};
  for (const key of [
    "title", "step", "step1Title", "step1Body", "step2Title", "step2Body",
    "step3Title", "step3Body", "step4Title", "step4Body", "name", "nameHint",
    "tagline", "taglineHint", "description", "descriptionHint", "brand",
    "brandHint", "country", "city", "cityHint", "contactPhone",
    "contactPhoneHint", "continue", "back", "createDraft", "publishHint",
    "selectCountry",
  ]) {
    labels[key] = labelFor(key);
  }

  return (
    <>
      <AppHeader title={translate(locale, "create.title")} back={`/${locale}/sell` as Route} />
      <Shell width="narrow">
        <div className="px-4 py-5">
          <StoreWizard
            locale={locale}
            action={createStoreAction}
            labels={labels}
            types={catalog.STORE_TYPES.map((type) => ({
              value: type,
              label: translate(locale, copyFor(type).label),
              tagline: translate(locale, copyFor(type).tagline),
            }))}
            brands={catalog.STORE_BRANDS.map((value) => ({
              value,
              label: BRAND_LABELS[value] ?? value,
            }))}
            countries={countries}
          />
        </div>
        <p className="px-4 pb-2 text-center text-caption text-muted">
          <Link href={`/${locale}/sell` as Route} className="hover:underline">
            {translate(locale, "create.back")}
          </Link>
        </p>
      </Shell>
    </>
  );
}
