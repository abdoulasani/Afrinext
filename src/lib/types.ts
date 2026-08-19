export type CategoryId =
  | "agriculture"
  | "artisans"
  | "fashion"
  | "food"
  | "logistics"
  | "services"
  | "tech";

export type Category = {
  id: CategoryId;
  label: string;
  emoji: string;
  blurb: string;
};

export type Listing = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: CategoryId;
  city: string;
  country: string;
  tags: string[];
  verified: boolean;
  rating: number;
  reviews: number;
  priceLabel: string;
  contact: {
    phone?: string;
    email?: string;
    website?: string;
  };
  createdAt: string;
};

export type ListingDraft = {
  name: string;
  tagline: string;
  description: string;
  category: CategoryId;
  city: string;
  country: string;
  tags: string[];
  priceLabel: string;
  contact: Listing["contact"];
};
