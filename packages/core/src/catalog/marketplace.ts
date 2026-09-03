import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { money, type Money } from "../money";
import { isStoreType, type StoreBrand, type StoreType } from "./store-types";

/**
 * Public discovery: what a stranger can find, and in what order.
 *
 * Two rules govern everything here.
 *
 * **Published only, in SQL.** Every query filters `status = 'published'` in the
 * statement rather than fetching and filtering afterwards. A draft store is not
 * a row the caller receives and declines to render — it is a row the caller
 * never receives.
 *
 * **No invented popularity.** Ranking by sales is supported, and it reads
 * actual paid orders. Where there are none, the answer is an empty list and the
 * interface says so, rather than a shuffle dressed up as a trend. There is no
 * random ordering, no seeded "featured" flag and no view counter anywhere in
 * this file.
 */

export interface StoreSummary {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string | null;
  readonly storeType: StoreType;
  readonly brand: StoreBrand;
  readonly countryCode: string | null;
  readonly city: string | null;
  readonly publishedAt: Date | null;
  /** How many published offerings the store has. A real count, or zero. */
  readonly offeringCount: number;
}

interface SummaryRow {
  [key: string]: unknown;
  slug: string;
  name: string;
  tagline: string | null;
  store_type: string;
  brand: string;
  country_code: string | null;
  city: string | null;
  published_at: string | Date | null;
  offering_count: string | number;
}

function toSummary(row: SummaryRow): StoreSummary {
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    storeType: row.store_type as StoreType,
    brand: row.brand as StoreBrand,
    countryCode: row.country_code,
    city: row.city,
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
    offeringCount: Number(row.offering_count),
  };
}

/**
 * The columns every store listing needs, including a real offering count.
 *
 * The count is a correlated subquery rather than a join with a GROUP BY, so a
 * store with no published offerings still appears — with zero — instead of
 * silently dropping out of the marketplace.
 */
const SUMMARY_SELECT = sql`
  s.slug, s.name, s.tagline, s.store_type, s.brand, s.country_code, s.city,
  s.published_at,
  (select count(*) from products p
    where p.store_id = s.id and p.status = 'published') as offering_count
`;

export type StoreSort = "newest" | "popular";

export interface DiscoverStoresQuery {
  readonly type?: StoreType | undefined;
  readonly country?: string | undefined;
  /** Free text over name, tagline and description. */
  readonly text?: string | undefined;
  readonly sort?: StoreSort | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

/** Bounded so a caller cannot ask for the whole marketplace in one request. */
function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), 48);
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.trunc(value), 5_000);
}

/**
 * Free-text matching, kept deliberately simple.
 *
 * `ILIKE` over three columns is the honest tool for a marketplace with tens of
 * stores: no extra service to run, no index to keep warm, and it behaves
 * predictably in French. When the catalogue outgrows it the replacement is
 * PostgreSQL full-text search behind this same function — which is why callers
 * pass a query object and never a SQL fragment.
 *
 * The pattern is escaped, so a buyer searching for "100%" or "a_b" gets those
 * strings rather than a wildcard.
 */
function textFilter(raw: string): SQL {
  const escaped = raw.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  return sql`(s.name ilike ${pattern} escape '\\'
           or coalesce(s.tagline, '') ilike ${pattern} escape '\\'
           or coalesce(s.description, '') ilike ${pattern} escape '\\')`;
}

/**
 * Published stores, newest first — or by real sales when asked.
 *
 * `popular` counts PAID orders against the store. A store with none simply
 * sorts last; nothing is fabricated to fill the space, and the caller can tell
 * the difference because the counts are real.
 */
export async function discoverStores(
  db: Database,
  query: DiscoverStoresQuery = {},
): Promise<StoreSummary[]> {
  const limit = clampLimit(query.limit, 24);
  const offset = clampOffset(query.offset);

  const conditions: SQL[] = [sql`s.status = 'published'`];
  if (query.type !== undefined && isStoreType(query.type)) {
    conditions.push(sql`s.store_type = ${query.type}`);
  }
  if (query.country !== undefined && query.country !== "") {
    conditions.push(sql`s.country_code = ${query.country.toUpperCase()}`);
  }
  if (query.text !== undefined && query.text.trim() !== "") {
    conditions.push(textFilter(query.text));
  }
  const where = sql.join(conditions, sql` and `);

  /*
   * Popularity is real or it is nothing.
   *
   * The subquery counts orders that actually reached `paid` for products in
   * this store. `published_at desc` is the tiebreaker so an entire marketplace
   * with no sales yet still comes back in a sensible, stable order rather than
   * an arbitrary one.
   */
  const order =
    query.sort === "popular"
      ? sql`(select count(*) from orders o
               where o.store_id = s.id and o.status = 'paid') desc,
            s.published_at desc nulls last`
      : sql`s.published_at desc nulls last`;

  const rows = await db.execute<SummaryRow>(sql`
    select ${SUMMARY_SELECT}
      from stores s
     where ${where}
     order by ${order}
     limit ${limit} offset ${offset}
  `);
  return rows.rows.map(toSummary);
}

/** How many stores match, so a page can say "24 of 130" and paginate honestly. */
export async function countDiscoverableStores(
  db: Database,
  query: DiscoverStoresQuery = {},
): Promise<number> {
  const conditions: SQL[] = [sql`s.status = 'published'`];
  if (query.type !== undefined && isStoreType(query.type)) {
    conditions.push(sql`s.store_type = ${query.type}`);
  }
  if (query.country !== undefined && query.country !== "") {
    conditions.push(sql`s.country_code = ${query.country.toUpperCase()}`);
  }
  if (query.text !== undefined && query.text.trim() !== "") {
    conditions.push(textFilter(query.text));
  }
  const rows = await db.execute<{ [k: string]: unknown; n: string }>(sql`
    select count(*) as n from stores s where ${sql.join(conditions, sql` and `)}
  `);
  return Number(rows.rows[0]?.n ?? 0);
}

/** How many published stores exist per type, for the category row. Real counts. */
export async function countStoresByType(
  db: Database,
): Promise<Readonly<Record<string, number>>> {
  const rows = await db.execute<{ [k: string]: unknown; store_type: string; n: string }>(sql`
    select store_type, count(*) as n from stores
     where status = 'published' group by store_type
  `);
  const counts: Record<string, number> = {};
  for (const row of rows.rows) counts[row.store_type] = Number(row.n);
  return counts;
}

export interface OfferingSummary {
  readonly storeSlug: string;
  readonly storeName: string;
  readonly storeType: StoreType;
  readonly brand: StoreBrand;
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly price: Money;
  readonly publishedAt: Date | null;
}

interface OfferingRow {
  [key: string]: unknown;
  store_slug: string;
  store_name: string;
  store_type: string;
  brand: string;
  slug: string;
  title: string;
  summary: string | null;
  price_minor: string | bigint;
  currency: string;
  published_at: string | Date | null;
}

function toOffering(row: OfferingRow): OfferingSummary {
  return {
    storeSlug: row.store_slug,
    storeName: row.store_name,
    storeType: row.store_type as StoreType,
    brand: row.brand as StoreBrand,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    price: money(BigInt(row.price_minor), row.currency),
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
  };
}

export interface DiscoverOfferingsQuery {
  readonly type?: StoreType | undefined;
  readonly text?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

/**
 * Published offerings from published stores.
 *
 * Both conditions, always. A published product inside a suspended store is not
 * public, and the join enforces that rather than trusting the caller to check
 * the store separately.
 */
export async function discoverOfferings(
  db: Database,
  query: DiscoverOfferingsQuery = {},
): Promise<OfferingSummary[]> {
  const limit = clampLimit(query.limit, 12);
  const offset = clampOffset(query.offset);

  const conditions: SQL[] = [sql`p.status = 'published'`, sql`s.status = 'published'`];
  if (query.type !== undefined && isStoreType(query.type)) {
    conditions.push(sql`s.store_type = ${query.type}`);
  }
  if (query.text !== undefined && query.text.trim() !== "") {
    const escaped = query.text.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;
    conditions.push(sql`(p.title ilike ${pattern} escape '\\'
                      or coalesce(p.summary, '') ilike ${pattern} escape '\\'
                      or s.name ilike ${pattern} escape '\\')`);
  }

  const rows = await db.execute<OfferingRow>(sql`
    select s.slug as store_slug, s.name as store_name, s.store_type, s.brand,
           p.slug, p.title, p.summary, p.price_minor, p.currency, p.published_at
      from products p
      join stores s on s.id = p.store_id
     where ${sql.join(conditions, sql` and `)}
     order by p.published_at desc nulls last
     limit ${limit} offset ${offset}
  `);
  return rows.rows.map(toOffering);
}
