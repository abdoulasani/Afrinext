"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ListingCard from "./ListingCard";
import { useHydrated, useSavedIds } from "@/lib/useSaved";
import type { Listing } from "@/lib/types";

export default function SavedList() {
  const hydrated = useHydrated();
  const savedIds = useSavedIds();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/listings", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Request failed");
        return response.json();
      })
      .then((data: { listings: Listing[] }) => setListings(data.listings))
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") setFailed(true);
      });

    return () => controller.abort();
  }, []);

  if (!hydrated || (listings === null && !failed)) {
    return (
      <div className="space-y-2.5 px-4 py-5">
        {[0, 1, 2].map((n) => (
          <div
            key={n}
            className="h-28 animate-pulse rounded-2xl border border-border bg-surface-muted"
          />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <Empty
        emoji="⚠️"
        title="Could not load listings"
        body="Check your connection and pull the page again."
      />
    );
  }

  const saved = savedIds
    .map((id) => listings?.find((l) => l.id === id))
    .filter((l): l is Listing => Boolean(l));

  if (saved.length === 0) {
    return (
      <Empty
        emoji="🔖"
        title="Nothing saved yet"
        body="Tap the bookmark on any listing to keep it here for later."
        action={
          <Link
            href="/browse"
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-contrast"
          >
            Browse listings
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-2.5 px-4 py-5">
      {saved.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}

function Empty({
  emoji,
  title,
  body,
  action,
}: {
  emoji: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-16 text-center">
      <p className="text-3xl" aria-hidden="true">
        {emoji}
      </p>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
