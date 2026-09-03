import Link from "next/link";
import type { Route } from "next";
import { StoreAvatar, StoreCover, StoreTypeIcon } from "@afrinext/ui";

/**
 * One store in a grid.
 *
 * The cover is now a band rather than a panel — 88 pixels, deep and lit — and
 * the store's name sits below it on the page's own surface at heading weight.
 * In the previous version the cover was 96px of saturated brand colour and the
 * name was 15px underneath, so the loudest thing on a card about a shop was a
 * rectangle. Reversing that is most of what makes a row of these read as
 * businesses instead of as swatches.
 *
 * What the card does NOT carry: a rating, a follower count, a "verified" tick
 * or a sales figure. Afrinext has no such data on day one, and inventing it to
 * make the grid look lively would be lying to buyers about a seller they are
 * deciding whether to trust.
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
    <li className="group" data-testid="store-card">
      <Link
        href={href as Route}
        className={
          "block overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface " +
          "transition-[transform,box-shadow,border-color] duration-[var(--duration-base)] " +
          "ease-[var(--ease-out)] hover:-translate-y-[3px] hover:border-border-strong " +
          "hover:shadow-[var(--shadow-lg)] active:translate-y-0 active:duration-[80ms] " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper " +
          "focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        }
      >
        <StoreCover brand={brand} className="h-[88px]" />

        {/* The avatar straddles the cover edge: it ties the two halves of the
            card together and gives the block below it a place to start. */}
        <div className="relative -mt-7 px-4 pb-4">
          <StoreAvatar name={name} brand={brand} size="md" ring />

          <h3 className="mt-3 truncate text-h3 text-foreground">{name}</h3>

          {tagline !== null && tagline !== "" && (
            <p className="mt-1 line-clamp-2 text-small text-muted">{tagline}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
            <span className="inline-flex items-center gap-1.5 text-foreground/75">
              <StoreTypeIcon type={storeType} className="h-3.5 w-3.5" />
              {typeLabel}
            </span>
            <span aria-hidden="true" className="text-faint">·</span>
            <span>{offeringLabel}</span>
            {location !== null && (
              <>
                <span aria-hidden="true" className="text-faint">·</span>
                <span>{location}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
