import type { ReactNode } from "react";

/**
 * A store's visual identity, drawn rather than uploaded.
 *
 * Every store has a cover and an avatar from the moment it is created, because
 * both are generated from its chosen brand palette and its name. That matters
 * more than it sounds: a marketplace whose stores mostly show a grey
 * placeholder looks abandoned, and asking a first-time seller in Niamey to
 * produce a logo before they can list anything is a wall, not an onboarding.
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

/**
 * The cover: a deep brand wash with a soft geometric field.
 *
 * The pattern is two overlapping radial gradients and a fine diagonal weave —
 * abstract, textile-adjacent, and deliberately NOT a motif borrowed from any
 * particular culture. It reads as considered material rather than as
 * decoration applied to look African.
 */
export function StoreCover({
  brand, className = "", children,
}: {
  brand: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-brand={brand}
      className={"relative overflow-hidden bg-[var(--brand)] " + className}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 12% 8%, rgba(255,255,255,0.30), transparent 60%)," +
            "radial-gradient(ellipse 70% 70% at 92% 96%, rgba(0,0,0,0.28), transparent 55%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.10]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(58deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 11px)",
        }}
      />
      {children}
    </div>
  );
}

/** The avatar: the store's initials on its brand colour. */
export function StoreAvatar({
  name, brand, size = "md", className = "",
}: {
  name: string;
  brand: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-10 w-10 text-[13px] rounded-[var(--radius-sm)]",
    md: "h-14 w-14 text-lg rounded-[var(--radius-md)]",
    lg: "h-20 w-20 text-2xl rounded-[var(--radius-lg)]",
  } as const;

  /*
   * Pale brand ground, deep brand initials.
   *
   * Not the brand colour itself: the avatar sits ON the store's cover, which
   * is that exact colour, so a brand-filled monogram disappears into it. The
   * soft tone contrasts strongly against the deep cover behind it and stays
   * legible on a plain white card, which is the other place this renders.
   */
  return (
    <div
      data-brand={brand}
      aria-hidden="true"
      className={
        "grid shrink-0 place-items-center bg-[var(--brand-soft)] font-semibold " +
        "tracking-tight text-[var(--brand)] ring-2 ring-surface shadow-[var(--shadow-sm)] " +
        sizes[size] + " " + className
      }
    >
      {storeInitials(name)}
    </div>
  );
}
