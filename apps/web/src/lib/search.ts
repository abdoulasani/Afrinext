import { isCategoryId } from "./categories";
import type { CategoryId, Listing } from "./types";

export type SortKey = "relevance" | "rating" | "newest";

export type Query = {
  q: string;
  category: CategoryId | null;
  country: string | null;
  verifiedOnly: boolean;
  sort: SortKey;
};

export const EMPTY_QUERY: Query = {
  q: "",
  category: null,
  country: null,
  verifiedOnly: false,
  sort: "relevance",
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseQuery(params: RawParams): Query {
  const category = first(params.category);
  const sort = first(params.sort);
  return {
    q: (first(params.q) ?? "").trim(),
    category: isCategoryId(category) ? category : null,
    country: first(params.country)?.trim() || null,
    verifiedOnly: first(params.verified) === "1",
    sort: sort === "rating" || sort === "newest" ? sort : "relevance",
  };
}

export function queryToSearchParams(query: Query): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.country) params.set("country", query.country);
  if (query.verifiedOnly) params.set("verified", "1");
  if (query.sort !== "relevance") params.set("sort", query.sort);
  return params;
}

export function isFiltered(query: Query): boolean {
  return Boolean(
    query.q || query.category || query.country || query.verifiedOnly,
  );
}

function haystack(listing: Listing): string {
  return [
    listing.name,
    listing.tagline,
    listing.description,
    listing.city,
    listing.country,
    ...listing.tags,
  ]
    .join(" ")
    .toLowerCase();
}

/** Cheap keyword score: name hits beat tag hits, which beat body hits. */
function score(listing: Listing, terms: string[]): number {
  if (terms.length === 0) return 0;
  const name = listing.name.toLowerCase();
  const tags = listing.tags.join(" ").toLowerCase();
  const body = haystack(listing);

  let total = 0;
  for (const term of terms) {
    if (name.includes(term)) total += 8;
    else if (tags.includes(term)) total += 4;
    else if (body.includes(term)) total += 2;
    else return -1; // every term must match somewhere
  }
  return total;
}

export function searchListings(listings: Listing[], query: Query): Listing[] {
  const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = listings
    .filter((l) => !query.category || l.category === query.category)
    .filter((l) => !query.country || l.country === query.country)
    .filter((l) => !query.verifiedOnly || l.verified)
    .map((listing) => ({ listing, score: score(listing, terms) }))
    .filter((entry) => entry.score >= 0);

  scored.sort((a, b) => {
    if (query.sort === "rating") return b.listing.rating - a.listing.rating;
    if (query.sort === "newest") {
      return b.listing.createdAt.localeCompare(a.listing.createdAt);
    }
    if (b.score !== a.score) return b.score - a.score;
    if (b.listing.verified !== a.listing.verified) {
      return b.listing.verified ? 1 : -1;
    }
    return b.listing.rating - a.listing.rating;
  });

  return scored.map((entry) => entry.listing);
}
