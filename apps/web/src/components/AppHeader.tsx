import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  back?: Route;
  action?: ReactNode;
  /**
   * What the title is, semantically.
   *
   * `h1` by default, because on most screens this bar IS the page heading. A
   * page that sets its own `<h1>` in the body — the product page, whose title
   * belongs beside the price and not only in a sticky strip — passes `"p"`, so
   * the document keeps exactly one top-level heading. Two `<h1>`s reading the
   * same words is not a styling detail: a screen-reader user navigating by
   * heading hears the page announce itself twice and cannot tell which one is
   * the content.
   */
  titleAs?: "h1" | "p";
};

export default function AppHeader({
  title, subtitle, back, action, titleAs: Title = "h1",
}: Props) {
  return (
    // `lg:top-16` clears the desktop navigation bar, which is fixed at the top
    // from `lg` up and is exactly h-16 tall. Without it this header sticks to
    // the viewport edge and slides underneath the nav on a laptop.
    <header
      className={
        "sticky top-0 z-30 border-b border-border/80 " +
        "bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] backdrop-blur-xl lg:top-16"
      }
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3 sm:max-w-2xl lg:max-w-5xl lg:px-6 xl:max-w-6xl">
        {back && (
          <Link
            href={back}
            aria-label="Go back"
            /* 44px, not 36: this is often the only way back out of a page,
               and it is reached with a thumb. */
            className={
              "-ml-2 flex h-11 w-11 shrink-0 items-center justify-center " +
              "rounded-[var(--radius-md)] text-muted transition-colors " +
              "hover:bg-surface-muted hover:text-foreground active:scale-[0.94]"
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M15 19 8 12l7-7" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <Title className="truncate text-h3 tracking-[-0.02em] text-foreground">
            {title}
          </Title>
          {subtitle && (
            <p className="truncate text-caption text-muted">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}
