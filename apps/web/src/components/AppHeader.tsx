import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  back?: Route;
  action?: ReactNode;
};

export default function AppHeader({ title, subtitle, back, action }: Props) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
        {back && (
          <Link
            href={back}
            aria-label="Go back"
            className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted"
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
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-muted">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}
