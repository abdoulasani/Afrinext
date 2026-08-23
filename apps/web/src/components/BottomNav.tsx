"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/**
 * The four places a person goes, in the shape each screen deserves.
 *
 * On a phone this is a tab bar fixed to the bottom, because that is where a
 * thumb rests, padded with `env(safe-area-inset-bottom)` so it clears the home
 * indicator rather than sitting under it.
 *
 * From `lg` up it becomes a bar across the top instead. A tab bar pinned to the
 * bottom of a 1400-pixel window is not the mobile design enhanced, it is the
 * mobile design left behind: the pointer is nowhere near the bottom edge, and
 * the bar eats a strip of a screen that has room to spare. Same four
 * destinations, same active state, same component — a different arrangement of
 * it, which is what progressive enhancement actually means.
 *
 * The labels are translated by the caller: this component knows about
 * navigation, not about language.
 */
export type NavTab = {
  href: string;
  label: string;
  icon: string;
  /** Matches this tab when the path starts here, beyond the locale prefix. */
  match: string;
};

export default function BottomNav({ tabs }: { tabs: readonly NavTab[] }) {
  const pathname = usePathname();
  // Strip /fr or /en so "is this tab active" is a question about the app.
  const path = pathname.replace(/^\/(fr|en)(?=\/|$)/, "") || "/";
  const isActive = (tab: NavTab): boolean =>
    tab.match === "/" ? path === "/" : path.startsWith(tab.match);

  const icon = (tab: NavTab, active: boolean, size: string) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.1 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={size}
      aria-hidden="true"
    >
      <path d={tab.icon} />
    </svg>
  );

  return (
    <>
      {/* ---------- Phone and tablet: a thumb-reachable tab bar ---------- */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/92 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-lg items-stretch">
          {tabs.map((tab) => {
            const active = isActive(tab);
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href as Route}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex h-16 flex-col items-center justify-center gap-1 text-[11px] " +
                    "font-medium transition-colors duration-[var(--duration-fast)] " +
                    (active ? "text-primary" : "text-muted hover:text-foreground")
                  }
                >
                  {icon(tab, active, "h-6 w-6")}
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ---------- Desktop: the same four, across the top ---------- */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 top-0 z-40 hidden border-b border-border bg-surface/92 backdrop-blur-md lg:block"
      >
        {/* A fixed h-16 so `AppHeader` and `Shell` can offset by a known amount. */}
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-primary">
            Afrinext
          </span>
          <ul className="flex items-center gap-1">
            {tabs.map((tab) => {
              const active = isActive(tab);
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href as Route}
                    aria-current={active ? "page" : undefined}
                    className={
                      "flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[14px] " +
                      "font-medium transition-colors duration-[var(--duration-fast)] " +
                      (active
                        ? "bg-primary-soft text-primary"
                        : "text-muted hover:bg-surface-muted hover:text-foreground")
                    }
                  >
                    {icon(tab, active, "h-[18px] w-[18px]")}
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}
