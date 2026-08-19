import Link from "next/link";
import AppHeader from "@/components/AppHeader";

export default function NotFound() {
  return (
    <>
      <AppHeader title="Not found" />
      <div className="px-4 py-16 text-center">
        <p className="text-3xl" aria-hidden="true">
          🧭
        </p>
        <h2 className="mt-3 font-semibold">This page does not exist</h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
          The listing may have been removed, or the link is wrong.
        </p>
        <Link
          href="/browse"
          className="mt-5 inline-block rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-contrast"
        >
          Browse listings
        </Link>
      </div>
    </>
  );
}
