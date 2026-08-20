import { sql } from "drizzle-orm";
import {
  bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { currencies, countries } from "./reference";
import { users } from "./identity";

/**
 * A seller's storefront.
 *
 * The slug is the store's public identity and sits in the URL, so it is unique
 * across the platform and constrained to a shape that cannot break a path or
 * be mistaken for one of ours. Ownership is a row here AND a scoped
 * `store_owner` role assignment — this column says who the store belongs to,
 * the role assignment is what `authorize()` reads. Neither is inferred from
 * the other at request time.
 */
export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    countryCode: text("country_code").references(() => countries.code),
    status: text("status").notNull().default("draft"), // draft | published | suspended
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stores_slug_key").on(t.slug),
    index("stores_owner_idx").on(t.ownerUserId),
    check("stores_status_valid", sql`${t.status} in ('draft','published','suspended')`),
    check("stores_slug_shape", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) between 3 and 48`),
  ],
);

/**
 * A thing for sale. Digital only in this phase, by explicit scope.
 *
 * The price is minor units plus a currency code, exactly as everywhere else:
 * the exponent lives in the `currencies` table, so XOF's zero decimals are a
 * row rather than a special case in this file. `price_minor` is a bigint and
 * the database refuses a non-positive one — a "paid product" that is free or
 * negative is not a state worth having.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(),
    storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    kind: text("kind").notNull().default("digital"),
    title: text("title").notNull(),
    summary: text("summary"),
    description: text("description"),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().references(() => currencies.code),
    status: text("status").notNull().default("draft"), // draft | published | archived
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unique within a store, not globally: two sellers may both have "ebook".
    uniqueIndex("products_store_slug_key").on(t.storeId, t.slug),
    index("products_store_idx").on(t.storeId),
    index("products_published_idx").on(t.status, t.publishedAt),
    check("products_kind_valid", sql`${t.kind} in ('digital')`),
    check("products_status_valid", sql`${t.status} in ('draft','published','archived')`),
    check("products_slug_shape", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) between 3 and 64`),
    check("products_price_positive", sql`${t.priceMinor} > 0`),
    // A published product must know when. Without this, "published" is a label
    // with no timestamp behind it and no way to order a catalogue by recency.
    check(
      "products_published_has_timestamp",
      sql`(${t.status} <> 'published') or (${t.publishedAt} is not null)`,
    ),
  ],
);
