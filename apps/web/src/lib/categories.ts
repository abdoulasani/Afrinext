import type { Category } from "./types";

export const CATEGORIES: Category[] = [
  {
    id: "agriculture",
    label: "Agriculture",
    emoji: "🌾",
    blurb: "Farms, produce and agri-inputs",
  },
  {
    id: "artisans",
    label: "Artisans",
    emoji: "🪡",
    blurb: "Craft, woodwork and handmade goods",
  },
  {
    id: "fashion",
    label: "Fashion",
    emoji: "👗",
    blurb: "Tailors, designers and textiles",
  },
  {
    id: "food",
    label: "Food",
    emoji: "🍲",
    blurb: "Kitchens, caterers and grocers",
  },
  {
    id: "logistics",
    label: "Logistics",
    emoji: "🚚",
    blurb: "Delivery, freight and storage",
  },
  {
    id: "services",
    label: "Services",
    emoji: "🛠️",
    blurb: "Trades, repairs and professionals",
  },
  {
    id: "tech",
    label: "Tech",
    emoji: "💻",
    blurb: "Software, hardware and IT support",
  },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category | undefined {
  return BY_ID.get(id as Category["id"]);
}

export function isCategoryId(value: unknown): value is Category["id"] {
  return typeof value === "string" && BY_ID.has(value as Category["id"]);
}
