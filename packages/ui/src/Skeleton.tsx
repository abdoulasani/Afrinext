/**
 * A placeholder for content that is on its way.
 *
 * Deliberately restrained: a slow sweep across a muted surface, not a pulsing
 * grey block. The point of a skeleton is to say "this is nearly here and it
 * will be shaped like this", so it should match the real element's dimensions
 * and then be quiet. A skeleton that draws attention to itself has failed.
 *
 * `aria-hidden`, because there is nothing here to read. The container that
 * swaps it for real content is what should carry `aria-busy`.
 */
export function Skeleton({
  className = "", rounded = "md",
}: {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "pill";
}) {
  return (
    <span
      aria-hidden="true"
      className={
        "block bg-surface-muted rounded-[var(--radius-" + rounded + ")] " + className
      }
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
        backgroundSize: "160% 100%",
        backgroundRepeat: "no-repeat",
        animation: "afx-shimmer 1.6s var(--ease-out) infinite",
      }}
    />
  );
}
