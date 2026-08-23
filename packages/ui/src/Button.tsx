import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * One button, four intents, three sizes.
 *
 * Every clickable thing in Afrinext comes from here. The alternative — a
 * slightly different button on each page — is the single fastest way to make a
 * product feel assembled from parts rather than designed.
 *
 * `lg` is the mobile default for primary actions: 48px of touch target, which
 * is what a thumb needs on a phone held one-handed.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold " +
  "transition-[background-color,color,box-shadow,transform] duration-[var(--duration-fast)] " +
  "ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-55 " +
  "active:scale-[0.985] whitespace-nowrap";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-contrast shadow-[var(--shadow-sm)] hover:brightness-110",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-muted",
  ghost: "text-foreground hover:bg-surface-muted",
  danger: "bg-primary-soft text-primary border border-primary/25 hover:bg-primary/15",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim();
}

export function Button({
  children, variant = "primary", size = "md", type = "button", className = "",
  disabled, ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
