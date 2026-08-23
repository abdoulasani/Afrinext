"use client";

import { useActionState, useState } from "react";
import { Button, buttonClass, Field, inputClass, StoreAvatar, StoreCover, StoreTypeIcon } from "@afrinext/ui";
import type { ActionState } from "@/lib/catalog-actions";

export type WizardType = { value: string; label: string; tagline: string };
export type WizardBrand = { value: string; label: string };
export type WizardCountry = { code: string; name: string };

type Labels = Readonly<Record<string, string>>;

/**
 * Opening a store, four questions at a time.
 *
 * The whole point is progressive disclosure. A single form with nine fields
 * tells a first-time seller in Niamey that this will be hard; four short
 * screens with one question each tell them it will not. Nothing is submitted
 * until the last step, so nobody creates a half-built store by abandoning the
 * flow, and the fourth step shows the REAL store — the same cover, monogram
 * and type badge the public page renders — so "publish" is never a leap of
 * faith.
 *
 * Client state holds the answers; the server still validates every one of
 * them. This component is a nicer way to fill in a form, not a security
 * boundary.
 */
export default function StoreWizard({
  locale, types, brands, countries, labels, action,
}: {
  locale: string;
  types: readonly WizardType[];
  brands: readonly WizardBrand[];
  countries: readonly WizardCountry[];
  labels: Labels;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, {});
  const [step, setStep] = useState(1);
  const [storeType, setStoreType] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState(brands[0]?.value ?? "laterite");
  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const total = 4;
  const canContinue = step === 1 ? storeType !== "" : step === 2 ? name.trim().length >= 2 : true;
  const chosenType = types.find((t) => t.value === storeType);

  return (
    <form action={dispatch} className="flex flex-col gap-6">
      {/* The answers travel as hidden fields so the server sees one submission. */}
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeType" value={storeType} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="tagline" value={tagline} />
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="brand" value={brand} />
      <input type="hidden" name="countryCode" value={countryCode} />
      <input type="hidden" name="city" value={city} />
      <input type="hidden" name="contactPhone" value={contactPhone} />

      {/* Progress: a real meter, announced, not just four coloured bars. */}
      <div>
        <p className="text-[12px] font-medium text-muted">
          {(labels["step"] ?? "").replace("{step}", String(step)).replace("{total}", String(total))}
        </p>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={step}
          aria-label={labels["title"] ?? ""}
          className="mt-2 flex gap-1.5"
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={
                "h-1.5 flex-1 rounded-full transition-colors duration-[var(--duration-slow)] " +
                (i < step ? "bg-primary" : "bg-border")
              }
            />
          ))}
        </div>
      </div>

      {/* ---------- 1. What do you offer? ---------- */}
      {step === 1 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{labels["step1Title"]}</legend>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{labels["step1Title"]}</h2>
            <p className="mt-1 text-sm text-muted">{labels["step1Body"]}</p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {types.map((type) => {
              const selected = storeType === type.value;
              return (
                <label
                  key={type.value}
                  data-testid={`wizard-type-${type.value}`}
                  className={
                    "flex cursor-pointer gap-3 rounded-[var(--radius-md)] border p-3.5 transition-colors " +
                    "duration-[var(--duration-fast)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 " +
                    "has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-offset-2 " +
                    (selected
                      ? "border-primary bg-primary-soft/50"
                      : "border-border bg-surface hover:border-muted/50")
                  }
                >
                  <input
                    type="radio"
                    name="storeTypeChoice"
                    value={type.value}
                    checked={selected}
                    onChange={() => setStoreType(type.value)}
                    className="sr-only"
                  />
                  <span className={selected ? "text-primary" : "text-muted"}>
                    <StoreTypeIcon type={type.value} className="h-6 w-6" />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold leading-tight">{type.label}</span>
                    <span className="text-[12px] leading-snug text-muted">{type.tagline}</span>
                  </span>
                  {/* Not colour alone: a check mark carries the same meaning. */}
                  {selected && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
                      strokeLinecap="round" strokeLinejoin="round"
                      className="ml-auto h-5 w-5 shrink-0 self-center text-primary" aria-hidden="true">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* ---------- 2. Identity ---------- */}
      {step === 2 && (
        <fieldset className="flex flex-col gap-4">
          <legend className="sr-only">{labels["step2Title"]}</legend>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{labels["step2Title"]}</h2>
            <p className="mt-1 text-sm text-muted">{labels["step2Body"]}</p>
          </div>

          <Field id="store-name" label={labels["name"] ?? ""} hint={labels["nameHint"]} required>
            {(p) => (
              <input {...p} type="text" value={name} maxLength={80} autoComplete="organization"
                onChange={(e) => setName(e.target.value)} className={inputClass} />
            )}
          </Field>

          <Field id="store-tagline" label={labels["tagline"] ?? ""} hint={labels["taglineHint"]}>
            {(p) => (
              <input {...p} type="text" value={tagline} maxLength={140}
                onChange={(e) => setTagline(e.target.value)} className={inputClass} />
            )}
          </Field>

          <Field id="store-description" label={labels["description"] ?? ""} hint={labels["descriptionHint"]}>
            {(p) => (
              <textarea {...p} value={description} rows={4} maxLength={2000}
                onChange={(e) => setDescription(e.target.value)} className={inputClass} />
            )}
          </Field>

          <fieldset>
            <legend className="text-[13px] font-medium">{labels["brand"]}</legend>
            <p className="mt-0.5 text-xs text-muted">{labels["brandHint"]}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {brands.map((option) => (
                <label
                  key={option.value}
                  data-testid={`wizard-brand-${option.value}`}
                  className="cursor-pointer"
                >
                  <input
                    type="radio"
                    name="brandChoice"
                    value={option.value}
                    checked={brand === option.value}
                    onChange={() => setBrand(option.value)}
                    className="peer sr-only"
                  />
                  <span
                    data-brand={option.value}
                    title={option.label}
                    className={
                      "grid h-11 w-11 place-items-center rounded-full bg-[var(--brand)] " +
                      "ring-offset-2 ring-offset-background transition-[box-shadow] " +
                      "peer-checked:ring-2 peer-checked:ring-foreground " +
                      "peer-focus-visible:ring-2 peer-focus-visible:ring-primary"
                    }
                  >
                    {brand === option.value && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.6}
                        strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                    )}
                    <span className="sr-only">{option.label}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
      )}

      {/* ---------- 3. Where ---------- */}
      {step === 3 && (
        <fieldset className="flex flex-col gap-4">
          <legend className="sr-only">{labels["step3Title"]}</legend>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{labels["step3Title"]}</h2>
            <p className="mt-1 text-sm text-muted">{labels["step3Body"]}</p>
          </div>

          <Field id="store-country" label={labels["country"] ?? ""}>
            {(p) => (
              <select {...p} value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
                className={inputClass}>
                <option value="">{labels["selectCountry"]}</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            )}
          </Field>

          <Field id="store-city" label={labels["city"] ?? ""} hint={labels["cityHint"]}>
            {(p) => (
              <input {...p} type="text" value={city} maxLength={80} autoComplete="address-level2"
                onChange={(e) => setCity(e.target.value)} className={inputClass} />
            )}
          </Field>

          <Field id="store-phone" label={labels["contactPhone"] ?? ""} hint={labels["contactPhoneHint"]}>
            {(p) => (
              <input {...p} type="tel" value={contactPhone} maxLength={20} inputMode="tel"
                onChange={(e) => setContactPhone(e.target.value)} className={inputClass} />
            )}
          </Field>
        </fieldset>
      )}

      {/* ---------- 4. The real thing ---------- */}
      {step === 4 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{labels["step4Title"]}</h2>
            <p className="mt-1 text-sm text-muted">{labels["step4Body"]}</p>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
            <StoreCover brand={brand} className="h-28" />
            {/*
              * `relative z-10`, exactly as on the public store page and the
              * marketplace card. `StoreCover` is positioned, so without a
              * stacking context of its own this block renders UNDERNEATH it and
              * the monogram is sliced in half by the cover's bottom edge —
              * which makes the preview a lie about the page it is previewing.
              */}
            <div className="relative z-10 -mt-8 px-4 pb-4">
              <StoreAvatar name={name || "?"} brand={brand} size="lg" />
              <h3 className="mt-2.5 text-xl font-semibold tracking-tight">{name}</h3>
              {tagline !== "" && <p className="mt-1 text-sm text-muted">{tagline}</p>}
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-[12px] font-medium text-muted">
                <StoreTypeIcon type={storeType} className="h-3.5 w-3.5" />
                {chosenType?.label}
              </p>
              {(city !== "" || countryCode !== "") && (
                <p className="mt-2 text-[13px] text-muted">
                  {[city, countries.find((c) => c.code === countryCode)?.name]
                    .filter((part) => part !== undefined && part !== "").join(", ")}
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted">{labels["publishHint"]}</p>
        </section>
      )}

      {state.error !== undefined && (
        <p role="alert" data-testid="wizard-error"
          className="rounded-[var(--radius-md)] bg-primary-soft px-3.5 py-2.5 text-sm font-medium text-primary">
          {state.error}
        </p>
      )}

      {/* ---------- Navigation ---------- */}
      <div className="flex items-center gap-3">
        {step > 1 && (
          <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)} data-testid="wizard-back">
            {labels["back"]}
          </Button>
        )}
        {step < total ? (
          <Button
            size="lg"
            className="flex-1"
            disabled={!canContinue}
            onClick={() => setStep(step + 1)}
            data-testid="wizard-next"
          >
            {labels["continue"]}
          </Button>
        ) : (
          <button type="submit" disabled={pending} data-testid="wizard-submit"
            className={buttonClass("primary", "lg", "flex-1")}>
            {labels["createDraft"]}
          </button>
        )}
      </div>
    </form>
  );
}
