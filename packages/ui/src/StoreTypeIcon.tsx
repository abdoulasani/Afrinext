/**
 * One line drawing per store type.
 *
 * Line icons rather than emoji: emoji render differently on every device, sit
 * awkwardly against a typographic layout, and cannot take a currentColor. The
 * six shapes share a stroke weight and a 24-unit grid so a row of them reads
 * as one family.
 */
const PATHS: Readonly<Record<string, string>> = {
  // A graduation cap — learning, taught by someone.
  formation: "M2.5 8.5 12 4l9.5 4.5L12 13 2.5 8.5Zm4 3.2V16c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-4.3M20.5 9v5",
  // A document with a download arrow — a file that becomes yours.
  digital_product: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M12 11.5v5m0 0 2-2m-2 2-2-2",
  // A parcel — something that travels to you.
  physical_product: "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Zm0 0L12 12m0 0 8.5-4.5M12 12v9",
  // A wrench — work done for you.
  service: "M14.7 6.3a4 4 0 0 0 5.1 5.1l-8.4 8.4a2.4 2.4 0 0 1-3.4-3.4l8.4-8.4Zm0 0L17 4l3 3-2.3 2.3",
  // An aperture — someone who makes things.
  creator: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0 4.5-7.8M12 21 7.5 13.2m0 0L3.3 15.6M7.5 13.2h9m0 0 4.2 2.4M16.5 13.2 12 5.4",
  // A van — it comes to you.
  delivery: "M3 7.5h10v9H3v-9Zm10 3h4l3 3v3h-7v-6Zm-6.5 6a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm10 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z",
};

export function StoreTypeIcon({
  type, className = "h-5 w-5",
}: {
  type: string;
  className?: string;
}) {
  const path = PATHS[type] ?? PATHS["digital_product"];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path as string} />
    </svg>
  );
}
