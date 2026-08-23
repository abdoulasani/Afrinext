import Link from "next/link";
import type { Route } from "next";
import { Card, StoreAvatar, StoreCover, StoreTypeIcon } from "@afrinext/ui";

/**
 * One store in a grid.
 *
 * The card carries a brand-washed cover, the store's monogram and its real
 * offering count. What it does NOT carry is a rating, a follower count, a
 * "verified" tick or a sales figure — Afrinext has no such data on day one,
 * and inventing it to make the grid look lively would be lying to buyers about
 * a seller they are deciding whether to trust.
 */
export default function StoreCard({
  href, name, tagline, brand, storeType, typeLabel, location, offeringLabel,
}: {
  href: string;
  name: string;
  tagline: string | null;
  brand: string;
  storeType: string;
  typeLabel: string;
  location: string | null;
  offeringLabel: string;
}) {
  return (
    <Card as="li" interactive className="overflow-hidden" data-testid="store-card">
      <Link href={href as Route} className="block focus-visible:outline-none">
        <StoreCover brand={brand} className="h-20 sm:h-24">
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            <StoreTypeIcon type={storeType} className="h-3.5 w-3.5" />
            {typeLabel}
          </span>
        </StoreCover>

        {/* relative z-10 so the monogram sits ON the cover, not under it. */}
        <div className="relative z-10 -mt-7 px-4 pb-4">
          <StoreAvatar name={name} brand={brand} size="md" />
          <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-foreground">
            {name}
          </h3>
          {tagline !== null && tagline !== "" && (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
              {tagline}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            <span className="font-medium text-foreground/80">{offeringLabel}</span>
            {location !== null && (
              <span className="inline-flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
                  strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                {location}
              </span>
            )}
          </div>
        </div>
      </Link>
    </Card>
  );
}
