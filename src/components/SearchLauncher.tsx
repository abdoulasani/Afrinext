"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Home-screen search box; hands the term off to /browse. */
export default function SearchLauncher() {
  const router = useRouter();
  const [term, setTerm] = useState("");

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = term.trim();
        router.push(q ? `/browse?q=${encodeURIComponent(q)}` : "/browse");
      }}
      className="flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 text-foreground shadow-sm"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        className="h-5 w-5 shrink-0 text-muted"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search shea butter, tailors, freight…"
        aria-label="Search listings"
        enterKeyHint="search"
        className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
      />
    </form>
  );
}
