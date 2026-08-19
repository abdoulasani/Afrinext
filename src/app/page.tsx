import Link from "next/link";
import ListingCard from "@/components/ListingCard";
import SearchLauncher from "@/components/SearchLauncher";
import { CATEGORIES } from "@/lib/categories";
import { allListings, countries } from "@/lib/store";

// Listings live in a mutable store, so render on request rather than at build.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const listings = allListings();
  const featured = [...listings]
    .filter((l) => l.verified)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 4);
  const recent = [...listings]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);

  return (
    <>
      <section
        className="bg-primary px-4 pb-6 pt-5 text-primary-contrast"
        style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] opacity-80">
          Afrinext
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight">
          Find the businesses that keep the continent moving.
        </h1>
        <p className="mt-2 text-sm opacity-90">
          {listings.length} listings across {countries().length} countries —
          suppliers, artisans, logistics and services.
        </p>
        <div className="mt-4">
          <SearchLauncher />
        </div>
      </section>

      <section className="px-4 py-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Categories
        </h2>
        <ul className="mt-3 grid grid-cols-2 gap-2.5">
          {CATEGORIES.map((category) => (
            <li key={category.id}>
              <Link
                href={`/browse?category=${category.id}`}
                className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-surface p-3 transition-colors active:bg-surface-muted"
              >
                <span className="text-xl" aria-hidden="true">
                  {category.emoji}
                </span>
                <span className="text-sm font-semibold">{category.label}</span>
                <span className="text-xs leading-snug text-muted">
                  {category.blurb}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pb-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Verified picks
          </h2>
          <Link href="/browse?verified=1&sort=rating" className="text-xs font-medium text-primary">
            See all
          </Link>
        </div>
        <div className="mt-3 space-y-2.5">
          {featured.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      </section>

      <section className="px-4 pb-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Recently added
          </h2>
          <Link href="/browse?sort=newest" className="text-xs font-medium text-primary">
            See all
          </Link>
        </div>
        <div className="mt-3 space-y-2.5">
          {recent.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>

        <Link
          href="/submit"
          className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-foreground px-4 py-3.5 text-sm font-semibold text-background"
        >
          List your business — it&apos;s free
        </Link>
      </section>
    </>
  );
}
