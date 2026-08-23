import type { ReactNode } from "react";

/**
 * The page container, mobile-first and then progressively wider.
 *
 * Afrinext is designed for a phone: `max-w-md` is the base, and every
 * measurement above it is an enhancement rather than the real design shrunk
 * down. But a marketplace that stays 448 pixels wide on a laptop looks like a
 * phone emulator, so discovery surfaces widen at each breakpoint while
 * focused, one-thing-at-a-time screens — a form, an order — deliberately stay
 * narrow, because a 1200px-wide text input is worse, not better.
 *
 * `pb-24` clears the fixed tab bar a phone has at the bottom. From `lg` up that
 * bar moves to the top, so the bottom padding shrinks — and the room for the
 * top bar is made once, by the locale layout, rather than by every Shell.
 */
export function Shell({
  children, width = "narrow", className = "",
}: {
  children: ReactNode;
  /** narrow: forms and detail. wide: discovery grids. full: immersive pages. */
  width?: "narrow" | "wide" | "full";
  className?: string;
}) {
  const widths = {
    narrow: "max-w-md",
    wide: "max-w-md sm:max-w-2xl lg:max-w-5xl xl:max-w-6xl",
    full: "max-w-none",
  } as const;

  return (
    <div className={`mx-auto w-full ${widths[width]} pb-24 lg:pb-16 ${className}`}>
      {children}
    </div>
  );
}
