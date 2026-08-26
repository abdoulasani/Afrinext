import type { Route } from "next";

/**
 * The marketplace's search field.
 *
 * A plain GET form, deliberately: it works before JavaScript loads, the result
 * is a real URL a person can share or bookmark, and the back button behaves.
 * A controlled client component here would cost interactivity on a slow phone
 * and buy nothing.
 *
 * It is designed to sit on the hero's ink panel, and that is what decides its
 * colours. A paper-white field on a dark ground is the highest contrast on the
 * page, which is where the eye should land first; the submit button inside it
 * is ink, so the two nest rather than compete. On a light surface elsewhere the
 * same component still reads correctly — the field simply stops being the
 * brightest thing in view, which is right, because there it should not be.
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
        className={
          "h-14 w-full rounded-[var(--radius-pill)] border border-transparent bg-white " +
          "pl-12 pr-[104px] text-body text-[#171310] shadow-[var(--shadow-lg)] " +
          "outline-none transition-shadow duration-[var(--duration-base)] " +
          "placeholder:text-[#7d6e60] focus:border-copper/40 focus:shadow-[var(--shadow-ink)] " +
          "[&::-webkit-search-cancel-button]:hidden"
        }
      />
      <button
        type="submit"
        className={
          "absolute right-2 top-2 h-10 rounded-[var(--radius-pill)] bg-[var(--ink)] px-5 " +
          "text-small font-semibold text-[var(--on-ink)] " +
          "transition-[background-color,transform] duration-[var(--duration-fast)] " +
          "hover:bg-[#2a2320] active:scale-[0.96]"
        }
      >
        {submitLabel}
      </button>
    </form>
  );
}
