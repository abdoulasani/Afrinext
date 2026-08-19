import { isCategoryId } from "./categories";
import type { ListingDraft } from "./types";

export type ValidationResult =
  | { ok: true; draft: ListingDraft }
  | { ok: false; errors: Record<string, string> };

const LIMITS = {
  name: 60,
  tagline: 90,
  description: 800,
  city: 60,
  country: 60,
  priceLabel: 60,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function required(
  errors: Record<string, string>,
  field: keyof typeof LIMITS,
  value: string,
  min = 2,
) {
  if (value.length < min) {
    errors[field] = `Please enter at least ${min} characters.`;
  } else if (value.length > LIMITS[field]) {
    errors[field] = `Please keep this under ${LIMITS[field]} characters.`;
  }
}

export function validateDraft(input: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  const body = (input ?? {}) as Record<string, unknown>;

  const name = text(body.name);
  const tagline = text(body.tagline);
  const description = text(body.description);
  const city = text(body.city);
  const country = text(body.country);
  const priceLabel = text(body.priceLabel) || "Contact for pricing";

  required(errors, "name", name);
  required(errors, "tagline", tagline, 8);
  required(errors, "description", description, 30);
  required(errors, "city", city);
  required(errors, "country", country);
  required(errors, "priceLabel", priceLabel);

  const category = text(body.category);
  if (!isCategoryId(category)) {
    errors.category = "Please choose a category.";
  }

  const rawTags = Array.isArray(body.tags)
    ? body.tags
    : text(body.tags).split(",");
  const tags = [
    ...new Set(
      rawTags
        .map((t) => text(t).toLowerCase())
        .filter(Boolean)
        .slice(0, 6),
    ),
  ];

  const contactInput = (body.contact ?? {}) as Record<string, unknown>;
  const phone = text(contactInput.phone);
  const email = text(contactInput.email);
  const website = text(contactInput.website);

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "That email address does not look right.";
  }
  if (website && !/^https?:\/\/\S+$/.test(website)) {
    errors.website = "Website must start with http:// or https://";
  }
  if (!phone && !email && !website) {
    errors.contact = "Add at least one way for buyers to reach you.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    draft: {
      name,
      tagline,
      description,
      category: category as ListingDraft["category"],
      city,
      country,
      tags,
      priceLabel,
      contact: {
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        ...(website ? { website } : {}),
      },
    },
  };
}
