import type { ReactNode } from "react";

/**
 * One shortcut in the services grid: a coloured pastille, then a short word.
 *
 * ---------------------------------------------------------------------------
 * Why a grid of these rather than a menu
 * ---------------------------------------------------------------------------
 *
 * A menu tells you where things are; a grid tells you what you can do. On a
 * phone the second question is the one somebody actually has, and answering it
 * in one screenful — eight pastilles, eight words — is why this pattern is
 * everywhere in apps people use daily. Afrinext's version carries marketplace
 * verbs rather than banking ones, but the ergonomics are the same.
 *
 * ---------------------------------------------------------------------------
 * The pastille colours are information, not decoration
 * ---------------------------------------------------------------------------
 *
 * Each shortcut keeps ONE tone, permanently. That is what makes the grid
 * learnable: after two visits somebody reaches for the green square without
 * reading the word under it, the same way they reach for a familiar app icon.
 * Rotating the colours, or tinting them all copper, would throw that away.
 *
 * The tones are the store-identity palette already in the tokens, so the grid
 * and a wall of storefronts are lit by the same six hues. Copper is NOT among
 * them: it stays the accent that marks a price and one action per screen, and
 * a grid of eight copper squares is exactly the "wall of orange" the palette
 * was rebuilt to remove.
 *
 * The label sits under the pastille rather than beside it, so a two-word French
 * label ("Ma boutique") wraps to two lines without knocking the row out of
 * alignment — `items-start` plus a fixed pastille size keeps every icon on the
 * same baseline whatever the labels do.
 */
export type ServiceTone =
  | "laterite" | "indigo" | "forest" | "ochre" | "aubergine" | "clay";

const TONES: Record<ServiceTone, string> = {
  laterite: "bg-[var(--brand-laterite-soft)] text-[var(--brand-laterite)]",
  indigo: "bg-[var(--brand-indigo-soft)] text-[var(--brand-indigo)]",
  forest: "bg-[var(--brand-forest-soft)] text-[var(--brand-forest)]",
  ochre: "bg-[var(--brand-ochre-soft)] text-[var(--brand-ochre)]",
  aubergine: "bg-[var(--brand-aubergine-soft)] text-[var(--brand-aubergine)]",
  clay: "bg-[var(--brand-clay-soft)] text-[var(--brand-clay)]",
};

export function ServiceTile({
  label, tone, icon, className = "",
}: {
  label: string;
  tone: ServiceTone;
  /** A 24×24 stroked path, drawn by the caller so icons stay tree-shaken. */
  icon: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={
        /*
         * min-h-11 on the whole tile, not just the pastille: the tap target is
         * the tile including its label, and 44px is the floor a thumb needs.
         */
        "group flex min-h-11 flex-col items-center gap-2 rounded-[var(--radius-md)] " +
        "px-1 py-2 text-center transition-transform duration-[var(--duration-fast)] " +
        "active:scale-[0.94] active:duration-[80ms] " + className
      }
    >
      <span
        aria-hidden="true"
        className={
          "flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-lg)] " +
          "transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] " +
          "group-hover:-translate-y-0.5 " + TONES[tone]
        }
      >
        {icon}
      </span>
      <span className="text-small font-medium leading-tight text-foreground">
        {label}
      </span>
    </span>
  );
}

/**
 * The grid the tiles sit in.
 *
 * Three across on a phone, which is what the current six shortcuts divide into
 * evenly: four columns left a row of four and an orphan row of two, and an
 * unbalanced grid reads as unfinished rather than as spacious. Three also buys
 * each label enough width that "Bibliothèque" and "Portefeuille" set on one
 * line at 390px instead of hyphenating.
 *
 * Six across from `lg`, where the same tiles would otherwise stretch into a
 * lonely single row of very wide, very empty squares.
 */
export function ServiceGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-x-2 gap-y-5 sm:gap-x-3 lg:grid-cols-6">
      {children}
    </div>
  );
}
