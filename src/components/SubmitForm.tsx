"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import type { Listing } from "@/lib/types";

type Errors = Record<string, string>;

const FIELDS = {
  name: "",
  tagline: "",
  description: "",
  category: "",
  city: "",
  country: "",
  tags: "",
  priceLabel: "",
  phone: "",
  email: "",
  website: "",
};

export default function SubmitForm() {
  const [values, setValues] = useState({ ...FIELDS });
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Listing | null>(null);

  const set = (key: keyof typeof FIELDS) => (value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});

    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          tagline: values.tagline,
          description: values.description,
          category: values.category,
          city: values.city,
          country: values.country,
          tags: values.tags.split(",").map((t) => t.trim()),
          priceLabel: values.priceLabel,
          contact: {
            phone: values.phone,
            email: values.email,
            website: values.website,
          },
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setCreated(data.listing as Listing);
        setValues({ ...FIELDS });
      } else {
        setErrors(
          (data.errors as Errors) ?? {
            form: data.error ?? "Something went wrong. Please try again.",
          },
        );
      }
    } catch {
      setErrors({ form: "Could not reach the server. Check your connection." });
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-3xl" aria-hidden="true">
          🎉
        </p>
        <h2 className="mt-3 text-lg font-semibold">{created.name} is live</h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
          It is listed straight away. Verification takes a few days and adds the
          badge to your card.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href={`/listing/${created.id}`}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-contrast"
          >
            View listing
          </Link>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="rounded-full border border-border px-4 py-2 text-xs font-medium"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 px-4 py-5">
      {errors.form && <Alert>{errors.form}</Alert>}

      <Field label="Business name" error={errors.name}>
        <input
          value={values.name}
          onChange={(e) => set("name")(e.target.value)}
          autoComplete="organization"
          className={input}
          placeholder="Sahel Grain Collective"
        />
      </Field>

      <Field label="One-line pitch" error={errors.tagline}>
        <input
          value={values.tagline}
          onChange={(e) => set("tagline")(e.target.value)}
          className={input}
          placeholder="Millet and sorghum straight from the co-op"
        />
      </Field>

      <Field label="Category" error={errors.category}>
        <select
          value={values.category}
          onChange={(e) => set("category")(e.target.value)}
          className={input}
        >
          <option value="">Choose a category…</option>
          {CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.emoji} {category.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="City" error={errors.city}>
          <input
            value={values.city}
            onChange={(e) => set("city")(e.target.value)}
            autoComplete="address-level2"
            className={input}
            placeholder="Maradi"
          />
        </Field>
        <Field label="Country" error={errors.country}>
          <input
            value={values.country}
            onChange={(e) => set("country")(e.target.value)}
            autoComplete="country-name"
            className={input}
            placeholder="Niger"
          />
        </Field>
      </div>

      <Field label="What you offer" error={errors.description}>
        <textarea
          value={values.description}
          onChange={(e) => set("description")(e.target.value)}
          rows={5}
          className={input}
          placeholder="What you sell, who you sell to, and how you deliver."
        />
      </Field>

      <Field
        label="Pricing"
        hint="Shown on your card — a range or “Contact for pricing” is fine."
        error={errors.priceLabel}
      >
        <input
          value={values.priceLabel}
          onChange={(e) => set("priceLabel")(e.target.value)}
          className={input}
          placeholder="From 18,000 XOF / 50kg bag"
        />
      </Field>

      <Field label="Tags" hint="Comma separated, up to six." error={errors.tags}>
        <input
          value={values.tags}
          onChange={(e) => set("tags")(e.target.value)}
          className={input}
          placeholder="wholesale, cereals, cooperative"
        />
      </Field>

      <fieldset className="space-y-3 rounded-2xl border border-border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          How buyers reach you
        </legend>
        {errors.contact && <Alert>{errors.contact}</Alert>}

        <Field label="Phone">
          <input
            value={values.phone}
            onChange={(e) => set("phone")(e.target.value)}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            className={input}
            placeholder="+227 90 00 00 01"
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <input
            value={values.email}
            onChange={(e) => set("email")(e.target.value)}
            type="email"
            autoComplete="email"
            inputMode="email"
            className={input}
            placeholder="hello@example.com"
          />
        </Field>
        <Field label="Website" error={errors.website}>
          <input
            value={values.website}
            onChange={(e) => set("website")(e.target.value)}
            type="url"
            inputMode="url"
            className={input}
            placeholder="https://example.com"
          />
        </Field>
      </fieldset>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-2xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-contrast disabled:opacity-60"
      >
        {submitting ? "Publishing…" : "Publish listing"}
      </button>
    </form>
  );
}

const input =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary";

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-[11px] font-medium text-primary">
          {error}
        </p>
      )}
    </label>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl bg-primary-soft px-3 py-2 text-xs font-medium text-primary"
    >
      {children}
    </p>
  );
}
