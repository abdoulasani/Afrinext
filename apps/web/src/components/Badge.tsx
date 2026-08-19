import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  tone?: "neutral" | "primary" | "accent";
};

const TONES = {
  neutral: "bg-surface-muted text-muted",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
} as const;

export default function Badge({ children, tone = "neutral" }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
