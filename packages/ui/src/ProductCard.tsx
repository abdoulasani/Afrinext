import type { ReactNode } from "react";
import { PriceTag } from "./PriceTag";

/**
 * One offering in a grid.
 *
 * ---------------------------------------------------------------------------
 * The plate
 * ---------------------------------------------------------------------------
 *
 * Afrinext has no product images yet — image upload is a later milestone — and
 * the honest answer to that is not a grey rectangle with a camera glyph, which
 * says "broken", nor a stock photograph, which says something untrue about
 * what is being sold. It is a *plate*: the seller's own identity, deep and lit,
 * carrying the mark of what kind of thing this is.
 *
 * It has a real job beyond filling space. Everything by one seller looks
 * related, so a buyer scanning a grid can see a shop rather than a pile, and
 * the plate is the same object that will hold a real photograph the day
 * uploads land — the layout does not change then, only what is inside it.
 *
 * ---------------------------------------------------------------------------
 * What is NOT here
 * ---------------------------------------------------------------------------
 *
 * No rating, no review count, no "best seller", no "only 2 left". Afrinext has
 * none of that data, and a card that invents it is lying to a buyer about a
 * seller they are deciding whether to trust. The props below are the complete
 * set of things this component is willing to say.
 */
export function ProductCard({
  href, title, storeName, price, brand, mark, badge, as: Tag = "li",
}: {
  href: string;
  title: string;
  storeName: string;
  /** Already formatted by the money layer. */
  price: string;
  brand: string;
  /** The type glyph — digital, course, physical. Drawn by the caller. */
  mark: ReactNode;
  /** One optional qualifier, e.g. the offering type. */
  badge?: ReactNode;
  as?: "li" | "div";
  /** Rendered by the caller so this package never imports a router. */
  linkAs?: never;
}) {
  return (
    <Tag className="group">
      <a href={href} className="block focus-visible:outline-none">
        <div
          data-brand={brand}
          className={
            "relative isolate aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-lg)] " +
            "bg-[var(--brand-deep)] transition-transform duration-[var(--duration-base)] " +
            "ease-[var(--ease-out)] group-hover:-translate-y-[3px] " +
            "group-focus-visible:-translate-y-[3px]"
          }
        >
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage: "var(--brand-motif)",
              backgroundSize: "var(--brand-motif-size, auto)",
            }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 90% 120% at 12% -8%, var(--brand), transparent 62%)",
            }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center text-[var(--on-ink)] opacity-90"
          >
            {mark}
          </span>
          {badge !== undefined && (
            <span className="absolute left-3 top-3 z-10">{badge}</span>
          )}
        </div>

        {/* Type carries the hierarchy here, not another border. */}
        <div className="mt-3">
          <h3 className="line-clamp-2 text-h3 text-foreground">{title}</h3>
          <p className="mt-1 truncate text-caption text-muted">{storeName}</p>
          <PriceTag amount={price} size="md" className="mt-2" />
        </div>
      </a>
    </Tag>
  );
}
