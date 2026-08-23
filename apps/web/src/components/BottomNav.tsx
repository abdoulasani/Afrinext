"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/**
 * The four places a person goes on a phone.
 *
 * Fixed to the bottom because that is where a thumb rests, and padded with
 * `env(safe-area-inset-bottom)` so it clears the home indicator rather than
 * sitting under it. The labels are translated by the caller — this component
 * knows about navigation, not about language.
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

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/92 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map((tab) => {
          const active = tab.match === "/" ? path === "/" : path.startsWith(tab.match);
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
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.1 : 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-6 w-6"
                  aria-hidden="true"
                >
                  <path d={tab.icon} />
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
