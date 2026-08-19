import Link from "next/link";
import Badge from "./Badge";
import SaveButton from "./SaveButton";
import Stars from "./Stars";
import { getCategory } from "@/lib/categories";
import type { Listing } from "@/lib/types";

export default function ListingCard({ listing }: { listing: Listing }) {
  const category = getCategory(listing.category);

  return (
    <article className="relative rounded-2xl border border-border bg-surface p-4 transition-shadow focus-within:shadow-md">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-xl"
        >
          {category?.emoji ?? "📍"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-semibold leading-tight">
              <Link href={`/listing/${listing.id}`} className="after:absolute after:inset-0">
                {listing.name}
              </Link>
            </h3>
            {listing.verified && (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4 shrink-0 text-accent"
                role="img"
                aria-label="Verified"
              >
                <path d="M12 2 14.4 4l2.9-.3 1 2.7 2.6 1.3-1 2.8 1 2.8-2.6 1.3-1 2.7-2.9-.3L12 22l-2.4-2-2.9.3-1-2.7-2.6-1.3 1-2.8-1-2.8 2.6-1.3 1-2.7 2.9.3L12 2Zm-1 12.8 5-5-1.4-1.4-3.6 3.6-1.6-1.6L8 11.8l3 3Z" />
              </svg>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted">
            {listing.tagline}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stars rating={listing.rating} reviews={listing.reviews} />
            <span className="text-xs text-muted">
              {listing.city}, {listing.country}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="primary">{category?.label ?? listing.category}</Badge>
            <Badge>{listing.priceLabel}</Badge>
          </div>
        </div>

        <div className="relative z-10">
          <SaveButton id={listing.id} name={listing.name} size="sm" />
        </div>
      </div>
    </article>
  );
}
