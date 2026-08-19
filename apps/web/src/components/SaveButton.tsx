"use client";

import { useHydrated, useSaved } from "@/lib/useSaved";

type Props = { id: string; name: string; size?: "sm" | "md" };

export default function SaveButton({ id, name, size = "md" }: Props) {
  const hydrated = useHydrated();
  const { saved, toggle } = useSaved(id);
  const on = hydrated && saved;
  const box = size === "sm" ? "h-8 w-8" : "h-10 w-10";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }}
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from saved` : `Save ${name}`}
      className={`${box} flex shrink-0 items-center justify-center rounded-full border border-border bg-surface transition-colors ${
        on ? "text-primary" : "text-muted"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinejoin="round"
        className={size === "sm" ? "h-4 w-4" : "h-5 w-5"}
        aria-hidden="true"
      >
        <path d="M6 3h12v18l-6-4.5L6 21V3Z" />
      </svg>
    </button>
  );
}
