import type { ReactNode } from "react";

/**
 * The icon set, drawn rather than imported.
 *
 * Twelve glyphs do not justify a dependency, and an icon package is one of the
 * easiest ways to end up with two visual grammars: a library's stroke weight
 * and corner radius are its own, not Afrinext's. These share one geometry —
 * 24×24, 1.7 stroke, round caps — so a shortcut pastille and a tab bar icon
 * look like they were drawn by the same hand, because they were.
 */
function Glyph({ d, size = 22 }: { d: string | string[]; size?: number }) {
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

export const icons: Record<string, ReactNode> = {
  // Discovery
  explore: <Glyph d={["M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z", "M21 21l-5.2-5.2"]} />,
  stores: <Glyph d={["M4 7.5h16", "M6 7.5V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1.5", "M5 7.5 6 20h12l1-12.5"]} />,
  // A stack of pages open at the top: what you own, not what you ordered.
  library: <Glyph d={["M4 6.5A1.5 1.5 0 0 1 5.5 5H10a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 14.5Z", "M20 6.5A1.5 1.5 0 0 0 18.5 5H14a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5Z"]} />,
  orders: <Glyph d={["M9 5h6", "M7 8.5h10l-1 11H8l-1-11Z", "M9.5 12v4", "M14.5 12v4"]} />,
  wallet: <Glyph d={["M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5Z", "M16 12.5h2.5"]} />,
  profile: <Glyph d={["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20a7.5 7.5 0 0 1 15 0"]} />,
  // Selling
  myStore: <Glyph d={["M4 9.5 5.5 5h13L20 9.5", "M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0", "M5.5 12v8h13v-8"]} />,
  products: <Glyph d={["M12 3 21 7.5v9L12 21 3 16.5v-9Z", "M3 7.5 12 12l9-4.5", "M12 12v9"]} />,
  sales: <Glyph d={["M4 18V9", "M10 18V5", "M16 18v-6", "M3 21h18"]} />,
  share: <Glyph d={["M12 15V4", "M8.5 7.5 12 4l3.5 3.5", "M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"]} />,
  // Chrome
  menu: <Glyph d={["M4 7h16", "M4 12h16", "M4 17h10"]} />,
  bell: <Glyph d={["M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z", "M10 18.5a2 2 0 0 0 4 0"]} />,
  globe: <Glyph d={["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M3.5 9h17", "M3.5 15h17", "M12 3a14 14 0 0 1 0 18", "M12 3a14 14 0 0 0 0 18"]} />,
  eye: <Glyph d={["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"]} />,
  eyeOff: <Glyph d={["M4 4l16 16", "M9.9 5.8A8.5 8.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4", "M6.3 8.1A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 2-.2 2.8-.5", "M10 10a3 3 0 0 0 4 4"]} />,
  arrow: <Glyph d={["M5 12h13", "M13 6.5 18.5 12 13 17.5"]} />,
  close: <Glyph d={["M6 6l12 12", "M18 6 6 18"]} />,
};
