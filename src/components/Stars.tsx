type Props = { rating: number; reviews: number };

export default function Stars({ rating, reviews }: Props) {
  if (reviews === 0) {
    return <span className="text-xs text-muted">No reviews yet</span>;
  }

  return (
    <span className="flex items-center gap-1 text-xs text-muted">
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3.5 w-3.5 text-primary"
        aria-hidden="true"
      >
        <path d="m12 2 2.9 6.3 6.8.8-5 4.7 1.3 6.8L12 17.3 6 20.6l1.3-6.8-5-4.7 6.8-.8L12 2Z" />
      </svg>
      <span className="font-semibold text-foreground">
        {rating.toFixed(1)}
      </span>
      <span aria-label={`${reviews} reviews`}>({reviews})</span>
    </span>
  );
}
