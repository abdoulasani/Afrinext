import { DomainError } from "../errors";

/**
 * The six businesses a store can be.
 *
 * One generic Store entity underneath; the type decides how the store
 * PRESENTS — which vocabulary a buyer sees, which sections the public page
 * shows, which dashboard the owner gets. It never decides what the store IS:
 * orders, payments, authorization and reconciliation see the same Store row
 * whatever the type says.
 *
 * The order here is the order the creation flow and the marketplace show.
 */
export const STORE_TYPES = [
  "formation",
  "digital_product",
  "physical_product",
  "service",
  "creator",
  "delivery",
] as const;

export type StoreType = (typeof STORE_TYPES)[number];

export class UnsupportedStoreTypeError extends DomainError {
  override readonly name = "UnsupportedStoreTypeError";
  constructor(received: unknown) {
    super(
      "catalog.store_type_unsupported",
      `"${String(received)}" is not a kind of store Afrinext offers. ` +
        `Supported: ${STORE_TYPES.join(", ")}.`,
    );
  }
}

export function isStoreType(value: unknown): value is StoreType {
  return typeof value === "string" && (STORE_TYPES as readonly string[]).includes(value);
}

/** Turns an untrusted value into a store type, or refuses. Nothing is defaulted. */
export function parseStoreType(raw: unknown): StoreType {
  if (!isStoreType(raw)) throw new UnsupportedStoreTypeError(raw);
  return raw;
}

/**
 * The curated visual identities a store chooses from.
 *
 * Each name is a color story the design system renders as a cover, an avatar
 * and accents — West African indigo dye, laterite earth, Sahel ochre. A
 * palette instead of an upload is deliberate: public image hosting is a
 * moderation and abuse surface that belongs to its own milestone, and a
 * curated palette guarantees every store looks composed on day one.
 */
export const STORE_BRANDS = [
  "laterite",
  "indigo",
  "forest",
  "ochre",
  "aubergine",
  "sable",
] as const;

export type StoreBrand = (typeof STORE_BRANDS)[number];

export class UnsupportedStoreBrandError extends DomainError {
  override readonly name = "UnsupportedStoreBrandError";
  constructor(received: unknown) {
    super(
      "catalog.store_brand_unsupported",
      `"${String(received)}" is not one of the Afrinext brand palettes.`,
    );
  }
}

export function isStoreBrand(value: unknown): value is StoreBrand {
  return typeof value === "string" && (STORE_BRANDS as readonly string[]).includes(value);
}

export function parseStoreBrand(raw: unknown): StoreBrand {
  if (!isStoreBrand(raw)) throw new UnsupportedStoreBrandError(raw);
  return raw;
}

/**
 * A stable default brand for a store that did not choose one.
 *
 * Derived from the slug so it is deterministic — the same store always gets
 * the same identity, previews match reality, and two neighbouring stores
 * usually differ. The owner can change it; this only decides the starting
 * point.
 */
export function defaultBrandFor(slug: string): StoreBrand {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STORE_BRANDS[hash % STORE_BRANDS.length] as StoreBrand;
}
