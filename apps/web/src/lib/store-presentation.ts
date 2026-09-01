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
  /**
   * The identity colour of this world, fixed forever.
   *
   * Not the store's own brand — a seller chooses that in the wizard. This is
   * the colour of the CATEGORY, so the six tiles on the marketplace read as
   * six different places rather than six copies of one. Once assigned it does
   * not move: somebody who has visited twice reaches for the green tile
   * without reading it, and rotating the palette would take that away.
   */
  readonly tone: "laterite" | "indigo" | "forest" | "ochre" | "aubergine" | "clay";
  readonly label: MessageKey;
  readonly singular: MessageKey;
  readonly tagline: MessageKey;
  /** What this type's offerings are called: "Formations", "Prestations". */
  readonly offerings: MessageKey;
  /**
   * The call to action for adding one.
   *
   * A store labelled "Formations" whose only button says "Add a digital
   * product" tells the seller the vocabulary is decoration. It is not: it is
   * the whole reason one table serves six trades.
   */
  readonly addOffering: MessageKey;
};

export const STORE_TYPE_COPY: Readonly<Record<string, StoreTypeCopy>> = {
  formation: {
    tone: "forest",
    label: "storeType.formation",
    singular: "storeType.formation.one",
    tagline: "storeType.formation.tagline",
    offerings: "offering.formation",
    addOffering: "offering.add.formation",
  },
  digital_product: {
    tone: "aubergine",
    label: "storeType.digital_product",
    singular: "storeType.digital_product.one",
    tagline: "storeType.digital_product.tagline",
    offerings: "offering.digital_product",
    addOffering: "offering.add.digital_product",
  },
  physical_product: {
    tone: "ochre",
    label: "storeType.physical_product",
    singular: "storeType.physical_product.one",
    tagline: "storeType.physical_product.tagline",
    offerings: "offering.physical_product",
    addOffering: "offering.add.physical_product",
  },
  service: {
    tone: "indigo",
    label: "storeType.service",
    singular: "storeType.service.one",
    tagline: "storeType.service.tagline",
    offerings: "offering.service",
    addOffering: "offering.add.service",
  },
  creator: {
    tone: "laterite",
    label: "storeType.creator",
    singular: "storeType.creator.one",
    tagline: "storeType.creator.tagline",
    offerings: "offering.creator",
    addOffering: "offering.add.creator",
  },
  delivery: {
    tone: "clay",
    label: "storeType.delivery",
    singular: "storeType.delivery.one",
    tagline: "storeType.delivery.tagline",
    offerings: "offering.delivery",
    addOffering: "offering.add.delivery",
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
