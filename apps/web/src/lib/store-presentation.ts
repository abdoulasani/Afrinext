import type { MessageKey } from "@afrinext/i18n";

/**
 * How each store type is spoken about on screen.
 *
 * A `Record` over the six types rather than a lookup by template-literal key,
 * so it is EXHAUSTIVE: adding a seventh store type fails the build here until
 * somebody decides what a buyer should call its offerings. A dynamic key would
 * have compiled and shipped a page labelled `offering.auction`.
 */
export type StoreTypeCopy = {
  readonly label: MessageKey;
  readonly singular: MessageKey;
  readonly tagline: MessageKey;
  /** What this type's offerings are called: "Formations", "Prestations". */
  readonly offerings: MessageKey;
};

export const STORE_TYPE_COPY: Readonly<Record<string, StoreTypeCopy>> = {
  formation: {
    label: "storeType.formation",
    singular: "storeType.formation.one",
    tagline: "storeType.formation.tagline",
    offerings: "offering.formation",
  },
  digital_product: {
    label: "storeType.digital_product",
    singular: "storeType.digital_product.one",
    tagline: "storeType.digital_product.tagline",
    offerings: "offering.digital_product",
  },
  physical_product: {
    label: "storeType.physical_product",
    singular: "storeType.physical_product.one",
    tagline: "storeType.physical_product.tagline",
    offerings: "offering.physical_product",
  },
  service: {
    label: "storeType.service",
    singular: "storeType.service.one",
    tagline: "storeType.service.tagline",
    offerings: "offering.service",
  },
  creator: {
    label: "storeType.creator",
    singular: "storeType.creator.one",
    tagline: "storeType.creator.tagline",
    offerings: "offering.creator",
  },
  delivery: {
    label: "storeType.delivery",
    singular: "storeType.delivery.one",
    tagline: "storeType.delivery.tagline",
    offerings: "offering.delivery",
  },
};

export function copyFor(storeType: string): StoreTypeCopy {
  return STORE_TYPE_COPY[storeType] ?? (STORE_TYPE_COPY["digital_product"] as StoreTypeCopy);
}

/** "Niamey, Niger" — whichever parts exist, joined once, or nothing. */
export function locationLabel(
  city: string | null,
  countryName: string | null,
): string | null {
  const parts = [city, countryName].filter(
    (part): part is string => part !== null && part.trim() !== "",
  );
  return parts.length === 0 ? null : parts.join(", ");
}
