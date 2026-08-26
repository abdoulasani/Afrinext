import type { ReactNode } from "react";

/**
 * A store's visual identity, drawn rather than uploaded.
 *
 * Every store has a cover and an avatar from the moment it is created, because
 * both are generated from its chosen palette and its name. That matters more
 * than it sounds: a marketplace whose stores mostly show a grey placeholder
 * looks abandoned, and asking a first-time seller in Niamey to produce a logo
 * before they can list anything is a wall, not an onboarding.
 *
 * ---------------------------------------------------------------------------
 * What changed, and why the old version was the single worst thing on screen
 * ---------------------------------------------------------------------------
 *
 * Covers used to be the store's brand colour at full saturation. On a
 * marketplace where most early stores pick the default, the home page became a
 * column of near-identical orange rectangles, each louder than the store name
 * printed under it — the cover was shouting a colour instead of saying whose
 * shop this was.
 *
 * Now the ground is `--brand-deep`, a near-ink version of the identity, lit
 * from one corner by the brand hue and textured with a motif that belongs to
 * that identity alone. A grid of stores reads as one dark, coherent family lit
 * in six different colours, which is what a considered marketplace looks like,
 * and the name in paper-white on top is the loudest thing on the card again.
 *
 * Uploads are a later milestone. When they arrive they replace the artwork
 * here and nothing else changes.
 */

/** The initials Afrinext draws when a store has no logo. One or two letters. */
export function storeInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  const first = [...(words[0] ?? "")][0] ?? "?";
  if (words.length === 1) return first.toUpperCase();
  const second = [...(words[1] ?? "")][0] ?? "";
  return (first + second).toUpperCase();
}

export function StoreCover({
  brand, className = "", children, scrim = false,
}: {
  brand: string;
  className?: string;
  children?: ReactNode;
  /**
   * The darkening at the foot of the cover.
   *
   * OFF by default, and that default is the fix for the first version of this:
   * a scrim exists to keep type legible over an image, so on a cover with
   * nothing laid over it, it only drains the colour — deep brand plus glow plus
   * a black gradient came out as mud on every card in the grid. It goes on
   * exactly where text sits on the cover, which is the lead store and nowhere
   * else.
   */
  scrim?: boolean;
}) {
  return (
    <div
      data-brand={brand}
      className={"relative isolate overflow-hidden bg-[var(--brand-deep)] " + className}
    >
      {/* The identity's own geometry, barely there. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage: "var(--brand-motif)",
          backgroundSize: "var(--brand-motif-size, auto)",
        }}
      />
      {/*
       * One light, from the top-left, in the identity's own hue.
       *
       * A source rather than a wash: the panel should look like a material with
       * a light falling across it, which is what gives a flat rectangle depth
       * without a single decorative gradient.
       */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 120% 150% at 0% -20%, var(--brand), transparent 70%)",
        }}
      />
      {scrim && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-3/4"
          style={{ backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.62), transparent)" }}
        />
      )}
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}

/**
 * The avatar: the store's initials.
 *
 * Paper-white on the identity's deep tone, so the same square works on a light
 * card and sitting on the cover itself — which the old pale-tint version did
 * not: on its own cover it dissolved.
 */
export function StoreAvatar({
  name, brand, size = "md", className = "", ring = false,
}: {
  name: string;
  brand: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** A paper ring, for when the avatar overlaps its own cover. */
  ring?: boolean;
}) {
  const sizes = {
    sm: "h-9 w-9 text-caption rounded-[var(--radius-sm)]",
    md: "h-12 w-12 text-h3 rounded-[var(--radius-md)]",
    lg: "h-16 w-16 text-h2 rounded-[var(--radius-lg)]",
  } as const;

  return (
    <div
      data-brand={brand}
      aria-hidden="true"
      className={
        "relative grid shrink-0 place-items-center overflow-hidden " +
        "bg-[var(--brand-deep)] font-semibold tracking-[-0.02em] text-[var(--on-ink)] " +
        sizes[size] +
        (ring ? " ring-[3px] ring-[var(--surface)]" : "") +
        " " + className
      }
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 opacity-80"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 100% 120% at 12% -10%, var(--brand), transparent 65%)",
        }}
      />
      <span className="relative">{storeInitials(name)}</span>
    </div>
  );
}
