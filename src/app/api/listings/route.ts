import { NextResponse } from "next/server";
import { addListing, allListings } from "@/lib/store";
import { parseQuery, searchListings } from "@/lib/search";
import { validateDraft } from "@/lib/validate";

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseQuery(params);
  const results = searchListings(allListings(), query);

  return NextResponse.json({ count: results.length, listings: results });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const result = validateDraft(body);
  if (!result.ok) {
    return NextResponse.json({ errors: result.errors }, { status: 422 });
  }

  const listing = addListing(result.draft);
  return NextResponse.json({ listing }, { status: 201 });
}
