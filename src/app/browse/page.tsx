import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import BrowseControls from "@/components/BrowseControls";
import ListingCard from "@/components/ListingCard";
import { getCategory } from "@/lib/categories";
import { isFiltered, parseQuery, searchListings } from "@/lib/search";
import { allListings, countries } from "@/lib/store";

export const metadata = { title: "Browse" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrowsePage({ searchParams }: Props) {
  const query = parseQuery(await searchParams);
  const results = searchListings(allListings(), query);
  const category = query.category ? getCategory(query.category) : undefined;

  return (
    <>
      <AppHeader
        title={category ? category.label : "Browse"}
        subtitle={`${results.length} ${results.length === 1 ? "listing" : "listings"}`}
      />

      <div className="px-4 py-4">
        <BrowseControls query={query} countryOptions={countries()} />
      </div>

      <div className="space-y-2.5 px-4 pb-8">
        {results.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}

        {results.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
            <p className="text-3xl" aria-hidden="true">
              🔍
            </p>
            <h2 className="mt-3 font-semibold">Nothing matched</h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
              {isFiltered(query)
                ? "Try fewer filters or a broader search term."
                : "There are no listings yet."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/browse"
                className="rounded-full border border-border px-4 py-2 text-xs font-medium"
              >
                Reset filters
              </Link>
              <Link
                href="/submit"
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-contrast"
              >
                List a business
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
