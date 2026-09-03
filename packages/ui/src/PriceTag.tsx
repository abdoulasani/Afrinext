/**
 * A price, treated as the most important number on the screen.
 *
 * In the old design a price was 13px muted-orange text sitting under a store
 * name in 15px semibold — so the least ambiguous, most decision-relevant fact
 * on a marketplace card was quieter than its title. Here it is copper,
 * tabular, and given real size.
 *
 * `tabular-nums` is not a detail: in a column of prices, proportional digits
 * make 8 000 and 11 000 start at different optical positions and the column
 * stops being scannable.
 *
 * FORMATTING IS THE CALLER'S JOB, and deliberately. Minor units and their
 * exponent live in the money domain — XOF has zero decimals, so anything here
 * that divided by a hundred would be wrong across the whole UEMOA zone. This
 * component receives a finished string and only decides how it looks.
 */
export type PriceSize = "sm" | "md" | "lg" | "xl";

export function PriceTag({
  amount, size = "md", tone = "copper", className = "", note, ...rest
}: {
  /** Already formatted by the money layer, e.g. "8 000 XOF". */
  amount: string;
  size?: PriceSize;
  tone?: "copper" | "foreground" | "onInk";
  className?: string;
  /** A quiet qualifier beside it: "Accès immédiat", "TVA incluse". */
  note?: string;
  /** Passed through, so a page can label its canonical price for a test. */
  "data-testid"?: string;
}) {
  const sizes: Record<PriceSize, string> = {
    sm: "text-small",
    md: "text-h3",
    lg: "text-h2",
    xl: "text-h1",
  };
  const tones = {
    copper: "text-copper",
    foreground: "text-foreground",
    onInk: "text-[var(--on-ink)]",
  } as const;

  return (
    <span {...rest} className={"inline-flex items-baseline gap-2 " + className}>
      <span
        className={
          "font-semibold tabular-nums tracking-[-0.02em] " + sizes[size] + " " + tones[tone]
        }
      >
        {amount}
      </span>
      {note !== undefined && (
        <span className="text-caption text-muted">{note}</span>
      )}
    </span>
  );
}
