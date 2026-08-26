import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Every clickable thing in Afrinext.
 *
 * ---------------------------------------------------------------------------
 * Why there are six variants and not one with a colour prop
 * ---------------------------------------------------------------------------
 *
 * A button's colour is not a decoration, it is a claim about importance, and a
 * screen with three equally loud buttons has told the reader nothing. The
 * variants are named for the JOB, so the choice at the call site is "how
 * important is this action" rather than "what colour do I feel like":
 *
 *   solid    the one action on the page. Ink on light, paper on dark —
 *            `--primary` inverts with the theme, so maximum contrast against
 *            the page is automatic rather than remembered.
 *   inverse  the one action on an INK PANEL, in either theme. Always paper on
 *            ink, because the panel does not invert.
 *   accent   copper. Reserved for the moment that genuinely deserves the eye —
 *            typically buying. Using it twice on a screen halves its value.
 *   outline  a real alternative the reader may well take. "Voir la boutique".
 *   ghost    a way back out. "Annuler", "Retour".
 *   danger   destruction, and nothing that is merely important.
 *
 * ---------------------------------------------------------------------------
 * The states are the craft
 * ---------------------------------------------------------------------------
 *
 * rest, hover, pressed, focus, disabled, loading — all six, on every variant.
 * `pressed` matters more on a phone than `hover` ever does: there is no cursor
 * to give feedback, so the 2% scale-down IS the feedback, and it is what makes
 * a tap feel like it landed on something physical. It is driven by `:active`
 * with a spring curve, which `prefers-reduced-motion` disables globally.
 *
 * `loading` keeps the button's exact width — measured from its resting label,
 * which stays in the DOM at zero opacity — because a submit button that shrinks
 * to a spinner makes the whole form jump under the thumb that just tapped it.
 */

export type ButtonVariant =
  | "solid" | "inverse" | "accent" | "outline" | "ghost" | "danger"
  /* The two above, for use ON an ink panel in either theme. */
  | "inverseOutline" | "inverseGhost"
  /*
   * The names this system replaced, kept as aliases rather than as a
   * rename-everything commit. Fourteen screens call `buttonClass("primary")`,
   * and none of them are wrong — "primary" still means the one action on the
   * page. They map onto the new variants and are retired screen by screen as
   * each is redesigned, so the design-system change does not have to land
   * simultaneously with every page that consumes it.
   */
  | "primary" | "secondary";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 " +
  "font-semibold tracking-[-0.01em] whitespace-nowrap " +
  "transition-[background-color,border-color,color,box-shadow,transform,opacity] " +
  "duration-[var(--duration-fast)] ease-[var(--ease-out)] " +
  "active:scale-[0.98] active:duration-[80ms] " +
  "disabled:pointer-events-none disabled:opacity-40";

const VARIANTS: Record<ButtonVariant, string> = {
  get primary() { return this.solid; },
  get secondary() { return this.outline; },
  solid:
    "rounded-[var(--radius-md)] bg-primary text-primary-contrast " +
    "shadow-[var(--shadow-sm)] hover:bg-[var(--primary-hover)] hover:shadow-[var(--shadow-md)]",
  inverse:
    "rounded-[var(--radius-md)] bg-[var(--on-ink)] text-[var(--ink)] " +
    "shadow-[var(--shadow-md)] hover:bg-white",
  accent:
    "rounded-[var(--radius-md)] bg-copper text-[var(--copper-contrast)] " +
    "shadow-[var(--shadow-sm)] hover:bg-[var(--copper-hover)] hover:shadow-[var(--shadow-md)]",
  outline:
    "rounded-[var(--radius-md)] border border-border-strong bg-transparent text-foreground " +
    "hover:border-foreground/35 hover:bg-surface-muted",
  ghost:
    "rounded-[var(--radius-md)] text-muted hover:bg-surface-muted hover:text-foreground",
  inverseOutline:
    "rounded-[var(--radius-md)] border border-[var(--on-ink-line)] bg-[var(--on-ink-raised)] " +
    "text-[var(--on-ink)] hover:border-[var(--on-ink)]/45 hover:bg-[var(--on-ink)]/12",
  inverseGhost:
    "rounded-[var(--radius-md)] text-[var(--on-ink)] hover:bg-[var(--on-ink-raised)]",
  danger:
    "rounded-[var(--radius-md)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] " +
    "text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white hover:border-transparent",
};

/*
 * Heights are touch targets first. 48px is what a thumb needs on a phone held
 * one-handed, so `lg` is the mobile default for anything primary; `sm` exists
 * for dense rows and toolbars, never for the main action on a screen.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-caption",
  md: "h-11 px-5 text-small",
  lg: "h-12 px-6 text-body",
};

export function buttonClass(
  variant: ButtonVariant = "solid",
  size: ButtonSize = "md",
  extra = "",
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim();
}

/** Three dots rather than a spinner: it reads at 16px, a spinner does not. */
function Dots() {
  return (
    <span className="absolute inset-0 flex items-center justify-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
          style={{ animation: `afx-pulse 1s ${i * 0.15}s infinite ease-in-out` }}
        />
      ))}
    </span>
  );
}

export function Button({
  children,
  variant = "solid",
  size = "md",
  type = "button",
  className = "",
  loading = false,
  disabled,
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Keeps the button's width and blocks the press without moving anything. */
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      // A loading button is not disabled for assistive technology — it is busy.
      // `aria-busy` says so; `disabled` alone would just make it disappear from
      // the reading order mid-submit.
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      <span className={loading ? "opacity-0" : "inline-flex items-center gap-2"}>
        {children}
      </span>
      {loading && <Dots />}
    </button>
  );
}
