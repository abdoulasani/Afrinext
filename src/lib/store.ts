import { SEED_LISTINGS } from "./seed";
import type { Listing, ListingDraft } from "./types";

/**
 * In-memory listing store. Submissions live for the lifetime of the server
 * process — swap this module for a real database without touching callers.
 */
type Store = { listings: Listing[] };

const globalForStore = globalThis as unknown as { afrinextStore?: Store };

function store(): Store {
  if (!globalForStore.afrinextStore) {
    globalForStore.afrinextStore = { listings: [...SEED_LISTINGS] };
  }
  return globalForStore.afrinextStore;
}

export function allListings(): Listing[] {
  return store().listings;
}

export function findListing(id: string): Listing | undefined {
  return store().listings.find((l) => l.id === id);
}

export function countries(): string[] {
  return [...new Set(store().listings.map((l) => l.country))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueId(base: string): string {
  const root = slugify(base) || "listing";
  let candidate = root;
  let n = 2;
  while (findListing(candidate)) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

export function addListing(draft: ListingDraft): Listing {
  const listing: Listing = {
    ...draft,
    id: uniqueId(draft.name),
    verified: false,
    rating: 0,
    reviews: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  store().listings.unshift(listing);
  return listing;
}
