"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { queryToSearchParams, type Query, type SortKey } from "@/lib/search";

type Props = { query: Query; countryOptions: string[] };

const SORTS: { key: SortKey; label: string }[] = [
  { key: "relevance", label: "Best match" },
  { key: "rating", label: "Top rated" },
  { key: "newest", label: "Newest" },
];

export default function BrowseControls({ query, countryOptions }: Props) {
  const router = useRouter();
  const [term, setTerm] = useState(query.q);
  const [lastQ, setLastQ] = useState(query.q);

  // Keep the box in step when navigation changes the query (back button, chips).
  if (lastQ !== query.q) {
    setLastQ(query.q);
    setTerm(query.q);
  }

  const go = (next: Partial<Query>) => {
    const params = queryToSearchParams({ ...query, ...next });
    const suffix = params.toString();
    router.push(suffix ? `/browse?${suffix}` : "/browse");
  };

  return (
    <div className="space-y-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go({ q: term.trim() });
        }}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          className="h-5 w-5 shrink-0 text-muted"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search listings"
          aria-label="Search listings"
          enterKeyHint="search"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              go({ q: "" });
            }}
            aria-label="Clear search"
            className="text-xs font-medium text-primary"
          >
            Clear
          </button>
        )}
      </form>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        <Chip
          active={query.category === null}
          onClick={() => go({ category: null })}
        >
          All
        </Chip>
        {CATEGORIES.map((category) => (
          <Chip
            key={category.id}
            active={query.category === category.id}
            onClick={() =>
              go({
                category: query.category === category.id ? null : category.id,
              })
            }
          >
            <span aria-hidden="true">{category.emoji}</span> {category.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="country">
          Country
        </label>
        <select
          id="country"
          value={query.country ?? ""}
          onChange={(event) => go({ country: event.target.value || null })}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium"
        >
          <option value="">All countries</option>
          {countryOptions.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="sort">
          Sort by
        </label>
        <select
          id="sort"
          value={query.sort}
          onChange={(event) => go({ sort: event.target.value as SortKey })}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium"
        >
          {SORTS.map((sort) => (
            <option key={sort.key} value={sort.key}>
              {sort.label}
            </option>
          ))}
        </select>

        <Chip
          active={query.verifiedOnly}
          onClick={() => go({ verifiedOnly: !query.verifiedOnly })}
        >
          Verified only
        </Chip>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-primary-contrast"
          : "border-border bg-surface text-muted"
      }`}
    >
      {children}
    </button>
  );
}
