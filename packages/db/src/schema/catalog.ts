import { sql } from "drizzle-orm";
import {
  bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
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
    /**
     * Which of the six businesses this store is. The type decides how the
     * store PRESENTS — vocabulary, sections, dashboard — never what it is:
     * orders, payments and authorization see one generic Store.
     */
    storeType: text("store_type").notNull().default("digital_product"),
    /** The longer "about" text, distinct from the one-line tagline. */
    description: text("description"),
    countryCode: text("country_code").references(() => countries.code),
    city: text("city"),
    /** A PUBLIC business contact the owner chose to show. Never the sign-in number. */
    contactPhone: text("contact_phone"),
    /** A named color story from the curated palette. Not an upload, on purpose. */
    brand: text("brand").notNull().default("laterite"),
    status: text("status").notNull().default("draft"), // draft | published | suspended
    /** Set once, at first publish. Re-publishing cannot bump a store to the top. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stores_slug_key").on(t.slug),
    index("stores_owner_idx").on(t.ownerUserId),
    check("stores_status_valid", sql`${t.status} in ('draft','published','suspended')`),
    check("stores_slug_shape", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) between 3 and 48`),
    check(
      "stores_type_valid",
      sql`${t.storeType} in ('formation','digital_product','physical_product','service','creator','delivery')`,
    ),
    check("stores_description_length", sql`${t.description} is null or char_length(${t.description}) <= 2000`),
    check("stores_city_length", sql`${t.city} is null or char_length(btrim(${t.city})) between 2 and 80`),
    check(
      "stores_contact_phone_shape",
      sql`${t.contactPhone} is null or ${t.contactPhone} ~ '^\+?[0-9][0-9 ]{6,18}[0-9]$'`,
    ),
    check(
      "stores_brand_valid",
      sql`${t.brand} in ('laterite','indigo','forest','ochre','aubergine','sable')`,
    ),
    check("stores_published_has_timestamp", sql`${t.status} <> 'published' or ${t.publishedAt} is not null`),
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
    /**
     * What a buyer may do with the files once entitled.
     *
     * `download` hands over the bytes; `view_only` serves them inline and
     * refuses an attachment. That second mode is a POLICY, not a protection:
     * anything a browser can render, a determined person can save. Calling it
     * DRM would be a lie, so nothing in this codebase does.
     */
    deliveryMode: text("delivery_mode").notNull().default("download"),
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
    check("products_delivery_mode_valid", sql`${t.deliveryMode} in ('download','view_only')`),
    // A published product must know when. Without this, "published" is a label
    // with no timestamp behind it and no way to order a catalogue by recency.
    check(
      "products_published_has_timestamp",
      sql`(${t.status} <> 'published') or (${t.publishedAt} is not null)`,
    ),
  ],
);

/**
 * The files behind a digital product.
 *
 * One product, many assets — a guide with a PDF and a worksheet, say. This is
 * deliberately the generic layer: a future Course → Module → Lesson structure
 * hangs its video and document resources off a table shaped like this one
 * rather than needing a parallel storage model. What it is NOT is that
 * structure, which this milestone does not build.
 *
 * `storage_key` is opaque and never leaves the server. It is not a URL, not a
 * path a client can construct, and not derived from anything a client knows —
 * the bytes are only ever reachable through an authorized server route.
 */
export const digitalAssets = pgTable(
  "digital_assets",
  {
    id: uuid("id").primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** document | file — coarse on purpose; `video` is a later milestone's word. */
    kind: text("kind").notNull().default("document"),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
    /** Lets a later integrity check prove the stored bytes are the stored bytes. */
    checksumSha256: text("checksum_sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("digital_assets_product_idx").on(t.productId, t.sortOrder),
    uniqueIndex("digital_assets_storage_key").on(t.storageKey),
    check("digital_assets_kind_valid", sql`${t.kind} in ('document','file')`),
    check("digital_assets_size_positive", sql`${t.byteSize} > 0`),
  ],
);
