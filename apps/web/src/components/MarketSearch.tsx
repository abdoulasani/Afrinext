import type { Route } from "next";

/**
 * The marketplace's search field.
 *
 * A plain GET form, deliberately: it works before JavaScript loads, the result
 * is a real URL a person can share or bookmark, and the back button behaves.
 * A controlled client component here would cost interactivity on a slow phone
 * and buy nothing.
 */
export default function MarketSearch({
  action, label, placeholder, submitLabel, defaultValue = "",
}: {
  action: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  defaultValue?: string;
}) {
  return (
    <form action={action as Route} role="search" className="relative">
      <label htmlFor="market-q" className="sr-only">{label}</label>
      <svg
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        id="market-q"
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        className="h-14 w-full rounded-full border border-border bg-surface pl-12 pr-28 text-[15px] text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted/70"
      />
      <button
        type="submit"
        className="absolute right-1.5 top-1.5 h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-contrast transition-[filter] hover:brightness-110"
      >
        {submitLabel}
      </button>
    </form>
  );
}
