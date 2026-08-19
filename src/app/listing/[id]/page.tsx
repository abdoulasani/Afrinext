import Link from "next/link";
import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import Badge from "@/components/Badge";
import ListingCard from "@/components/ListingCard";
import SaveButton from "@/components/SaveButton";
import Stars from "@/components/Stars";
import { getCategory } from "@/lib/categories";
import { allListings, findListing } from "@/lib/store";

// Listings live in a mutable store, so render on request rather than at build.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const listing = findListing(id);
  if (!listing) return { title: "Listing not found" };

  return { title: listing.name, description: listing.tagline };
}

export default async function ListingPage({ params }: Props) {
  const { id } = await params;
  const listing = findListing(id);
  if (!listing) notFound();

  const category = getCategory(listing.category);
  const related = allListings()
    .filter((l) => l.category === listing.category && l.id !== listing.id)
    .slice(0, 2);

  const contactRows = [
    listing.contact.phone && {
      label: "Call",
      value: listing.contact.phone,
      href: `tel:${listing.contact.phone.replace(/\s/g, "")}`,
    },
    listing.contact.email && {
      label: "Email",
      value: listing.contact.email,
      href: `mailto:${listing.contact.email}`,
    },
    listing.contact.website && {
      label: "Website",
      value: listing.contact.website.replace(/^https?:\/\//, ""),
      href: listing.contact.website,
    },
  ].filter(Boolean) as { label: string; value: string; href: string }[];

  return (
    <>
      <AppHeader
        title={listing.name}
        subtitle={`${listing.city}, ${listing.country}`}
        back="/browse"
        action={<SaveButton id={listing.id} name={listing.name} />}
      />

      <div className="px-4 py-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-2xl"
          >
            {category?.emoji ?? "📍"}
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight">
              {listing.name}
            </h2>
            <p className="mt-1 text-sm text-muted">{listing.tagline}</p>
            <div className="mt-2">
              <Stars rating={listing.rating} reviews={listing.reviews} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {listing.verified && <Badge tone="accent">✓ Verified</Badge>}
          <Badge tone="primary">{category?.label ?? listing.category}</Badge>
          <Badge>{listing.priceLabel}</Badge>
        </div>

        <section className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            About
          </h3>
          <p className="mt-2 text-sm leading-relaxed">{listing.description}</p>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Contact
          </h3>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {contactRows.map((row) => (
              <li key={row.label}>
                <a
                  href={row.href}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  {...(row.label === "Website"
                    ? { target: "_blank", rel: "noreferrer noopener" }
                    : {})}
                >
                  <span className="font-medium text-muted">{row.label}</span>
                  <span className="truncate text-primary">{row.value}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        {listing.tags.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Tags
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {listing.tags.map((tag) => (
                <Link key={tag} href={`/browse?q=${encodeURIComponent(tag)}`}>
                  <Badge>#{tag}</Badge>
                </Link>
              ))}
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-8">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              More in {category?.label ?? "this category"}
            </h3>
            <div className="mt-3 space-y-2.5">
              {related.map((item) => (
                <ListingCard key={item.id} listing={item} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
