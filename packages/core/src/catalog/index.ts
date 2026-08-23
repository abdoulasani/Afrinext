import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { requireAccountConsent, requireConsent, type LegalDocumentKind } from "../consent";
import {
  defaultBrandFor, parseStoreBrand, parseStoreType, type StoreBrand, type StoreType,
} from "./store-types";
import { DomainError } from "../errors";
import { uuidv7 } from "../ids";
import { money, type Money } from "../money";
import { assertUsableSlug, slugify } from "./slug";

export * from "./slug";
export * from "./store-types";
export * from "./marketplace";

/**
 * Stores and digital products.
 *
 * Every rule about who may do what, and what a valid product is, lives here.
 * The route handlers and server actions in apps/web are transport: they resolve
 * an actor, call one of these functions, and render the result. Nothing in
 * apps/web decides authorization or touches money, so a future API service is a
 * repackaging of this file rather than a reimplementation of it.
 */

export class StoreNotFoundError extends DomainError {
  override readonly name = "StoreNotFoundError";
  constructor(ref: string) {
    super("catalog.store_not_found", `No store matches "${ref}".`);
  }
}

export class ProductNotFoundError extends DomainError {
  override readonly name = "ProductNotFoundError";
  constructor(ref: string) {
    super("catalog.product_not_found", `No product matches "${ref}".`);
  }
}

export class SlugTakenError extends DomainError {
  override readonly name = "SlugTakenError";
  constructor(slug: string) {
    super("catalog.slug_taken", `"${slug}" is already in use.`);
  }
}

export class NotPublishableError extends DomainError {
  override readonly name = "NotPublishableError";
  constructor(why: string) {
    super("catalog.not_publishable", why);
  }
}

export class UnsupportedCurrencyError extends DomainError {
  override readonly name = "UnsupportedCurrencyError";
  constructor(currency: string) {
    super(
      "catalog.unsupported_currency",
      `${currency} is not available for pricing. Currencies come from the currencies table, not from code.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export interface StoreRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly tagline: string | null;
  readonly storeType: StoreType;
  readonly description: string | null;
  readonly countryCode: string | null;
  readonly city: string | null;
  readonly contactPhone: string | null;
  readonly brand: StoreBrand;
  readonly status: "draft" | "published" | "suspended";
  readonly publishedAt: Date | null;
  readonly ownerUserId: string;
}

interface StoreRow {
  [key: string]: unknown;
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  store_type: string;
  description: string | null;
  country_code: string | null;
  city: string | null;
  contact_phone: string | null;
  brand: string;
  status: string;
  published_at: string | Date | null;
  owner_user_id: string;
}

/** Every store read selects the same columns, so the list exists once. */
const STORE_COLUMNS = sql`
  id, slug, name, tagline, store_type, description, country_code, city,
  contact_phone, brand, status, published_at, owner_user_id
`;

function toStore(row: StoreRow): StoreRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    storeType: row.store_type as StoreType,
    description: row.description,
    countryCode: row.country_code,
    city: row.city,
    contactPhone: row.contact_phone,
    brand: row.brand as StoreBrand,
    status: row.status as StoreRecord["status"],
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
    ownerUserId: row.owner_user_id,
  };
}

/**
 * The documents that govern opening a store.
 *
 * Review decision: `seller_terms` only. It is the document whose subject matter
 * is the action being taken; the general terms are gated at signup, which is a
 * later milestone and a different flow. Listed here rather than passed in by a
 * caller, so no transport can shorten the list.
 */
export const SELLER_CONSENT_KINDS: readonly LegalDocumentKind[] = ["seller_terms"];

export interface CreateStoreInput {
  readonly name: string;
  /**
   * Which of the six businesses this is. REQUIRED and validated: there is no
   * sensible default, and guessing would decide how somebody's shop presents
   * itself to buyers.
   *
   * Typed as raw rather than `StoreType`, and that is deliberate. When it was
   * `StoreType`, every HTTP boundary had to call `parseStoreType` to satisfy
   * the compiler — which put input validation BEFORE `authorize()` and
   * `requireSellerConsent()`, so a caller with no permission was answered
   * "unsupported store type" instead of "denied". `createStore` parses this
   * itself, after the gates. The type system must not be able to reorder them.
   */
  readonly storeType: StoreType | (string & {});
  /** Optional: derived from the name when absent. */
  readonly slug?: string | undefined;
  readonly tagline?: string | undefined;
  readonly description?: string | undefined;
  readonly countryCode?: string | undefined;
  readonly city?: string | undefined;
  readonly contactPhone?: string | undefined;
  /** Optional: derived from the slug when absent. Raw, for the reason above. */
  readonly brand?: StoreBrand | (string & {}) | undefined;
}

/**
 * Refuses to proceed unless the actor has accepted the current seller terms.
 *
 * The locale and country are read from the actor's own `users` row, never taken
 * from the request. That is the whole difference between a gate and a
 * suggestion: if a caller could name the locale, it could name one with no
 * published document and — before `requireConsent` was made to fail closed —
 * walk straight through. Now an unresolvable document is itself a refusal, but
 * the identity of the person still decides which document applies.
 */
export async function requireSellerConsent(db: Database, actor: Actor): Promise<void> {
  const rows = await db.execute<{ locale: string; country_code: string | null }>(sql`
    select locale, country_code from users where id = ${actor.userId}::uuid
  `);
  const person = rows.rows[0];
  if (person === undefined) throw new StoreNotFoundError(actor.userId);

  // The general terms bind every account, not only sellers. An active account
  // whose terms changed last week must accept the new ones here too.
  await requireAccountConsent(db, actor.userId);

  await requireConsent(db, actor.userId, SELLER_CONSENT_KINDS, {
    locale: person.locale,
    ...(person.country_code !== null ? { countryCode: person.country_code } : {}),
  });
}

/**
 * Opens a store and makes its creator its owner.
 *
 * The `store_owner` role is granted in the same transaction as the insert.
 * Doing it afterwards would leave a window in which a store exists that nobody
 * can administer, and doing it lazily at request time ("the owner column says
 * you, so you may") would put an authorization decision outside `authorize()`.
 */
export async function createStore(
  db: Database,
  actor: Actor,
  input: CreateStoreInput,
): Promise<StoreRecord> {
  await authorize(db, actor, "store.create");
  await requireSellerConsent(db, actor);

  // Validated before anything is written, so an unsupported type or brand
  // leaves no row behind.
  const storeType = parseStoreType(input.storeType);

  const slug = input.slug ?? slugify(input.name);
  assertUsableSlug(slug, "store");
  const brand = input.brand === undefined ? defaultBrandFor(slug) : parseStoreBrand(input.brand);

  const taken = await db.execute(sql`select 1 from stores where slug = ${slug}`);
  if (taken.rows.length > 0) throw new SlugTakenError(slug);

  const storeId = uuidv7();
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into stores (id, owner_user_id, slug, name, tagline, store_type, description,
                          country_code, city, contact_phone, brand, status)
      values (${storeId}, ${actor.userId}::uuid, ${slug}, ${input.name},
              ${input.tagline ?? null}, ${storeType}, ${input.description ?? null},
              ${input.countryCode ?? null}, ${input.city ?? null},
              ${input.contactPhone ?? null}, ${brand}, 'draft')
    `);
    await tx.execute(sql`
      insert into role_assignments (id, user_id, role_id, scope_type, scope_id, granted_by)
      select ${uuidv7()}, ${actor.userId}::uuid, r.id, 'store', ${storeId}::uuid, ${actor.userId}::uuid
        from roles r where r.key = 'store_owner'
    `);
  });

  await audit(db, {
    actorKind: "user",
    actorUserId: actor.userId,
    action: "store.created",
    targetType: "store",
    targetId: storeId,
    context: { slug, name: input.name, storeType },
  });

  const created = await db.execute<StoreRow>(sql`
    select ${STORE_COLUMNS} from stores where id = ${storeId}
  `);
  return toStore(created.rows[0]!);
}

export interface UpdateStoreInput {
  readonly name?: string | undefined;
  readonly tagline?: string | undefined;
  readonly description?: string | undefined;
  readonly countryCode?: string | undefined;
  readonly city?: string | undefined;
  readonly contactPhone?: string | undefined;
  readonly brand?: StoreBrand | undefined;
  /**
   * The type is editable while the store is still a DRAFT.
   *
   * Once published, buyers have seen the store presented one way and its
   * offerings were written for that presentation; silently turning a formation
   * into a delivery service is not an edit, it is a different business.
   */
  readonly storeType?: StoreType | (string & {}) | undefined;
}

/** Changes a store's public identity. The slug is deliberately not editable. */
export async function updateStore(
  db: Database,
  actor: Actor,
  storeId: string,
  patch: UpdateStoreInput,
): Promise<StoreRecord> {
  await authorize(db, actor, "store.update", { type: "store", id: storeId });

  const brand = patch.brand === undefined ? null : parseStoreBrand(patch.brand);
  const storeType = patch.storeType === undefined ? null : parseStoreType(patch.storeType);

  const updated = await db.execute<StoreRow>(sql`
    update stores set
      name = coalesce(${patch.name ?? null}, name),
      tagline = coalesce(${patch.tagline ?? null}, tagline),
      description = coalesce(${patch.description ?? null}, description),
      country_code = coalesce(${patch.countryCode ?? null}, country_code),
      city = coalesce(${patch.city ?? null}, city),
      contact_phone = coalesce(${patch.contactPhone ?? null}, contact_phone),
      brand = coalesce(${brand}, brand),
      -- Draft only. The guard is in the statement rather than a prior read, so
      -- a publish racing this edit cannot slip a type change through.
      store_type = case when status = 'draft' then coalesce(${storeType}, store_type)
                        else store_type end,
      updated_at = now()
    where id = ${storeId}
    returning ${STORE_COLUMNS}
  `);
  const row = updated.rows[0];
  if (row === undefined) throw new StoreNotFoundError(storeId);
  if (storeType !== null && row.store_type !== storeType) {
    throw new NotPublishableError(
      "A store's kind can only be changed while it is still a draft.",
    );
  }

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "store.updated",
    targetType: "store", targetId: storeId, context: { fields: Object.keys(patch) },
  });
  return toStore(row);
}

/** A store must be published before anything under it can be reached publicly. */
export async function publishStore(
  db: Database,
  actor: Actor,
  storeId: string,
): Promise<StoreRecord> {
  await authorize(db, actor, "store.update", { type: "store", id: storeId });

  const updated = await db.execute<StoreRow>(sql`
    update stores set
      status = 'published',
      -- coalesce, not now(): first publish stamps it and later ones leave it
      -- alone, so "newest stores" cannot be gamed by unpublishing and
      -- republishing.
      published_at = coalesce(published_at, now()),
      updated_at = now()
     where id = ${storeId} and status <> 'suspended'
    returning ${STORE_COLUMNS}
  `);
  const row = updated.rows[0];
  if (row === undefined) {
    throw new NotPublishableError("That store cannot be published. A suspended store stays hidden.");
  }

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "store.published",
    targetType: "store", targetId: storeId, context: { slug: row.slug },
  });
  return toStore(row);
}

/**
 * Takes a store out of public view. Moderation, not the owner's own action.
 *
 * `store.moderate` is a platform permission, so an owner cannot suspend a
 * rival and a moderator does not need to be made an owner to act. The reason
 * is required and audited: a suspension somebody cannot explain later is a
 * suspension that should not have happened.
 */
export async function suspendStore(
  db: Database,
  actor: Actor,
  storeId: string,
  reason: string,
): Promise<StoreRecord> {
  await authorize(db, actor, "store.moderate");
  const why = reason.trim();
  if (why.length < 4) {
    throw new NotPublishableError("Say why the store is being suspended.");
  }

  const updated = await db.execute<StoreRow>(sql`
    update stores set status = 'suspended', suspended_at = now(), updated_at = now()
     where id = ${storeId}::uuid
    returning ${STORE_COLUMNS}
  `);
  const row = updated.rows[0];
  if (row === undefined) throw new StoreNotFoundError(storeId);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "store.suspended",
    targetType: "store", targetId: storeId, context: { slug: row.slug, reason: why },
  });
  return toStore(row);
}

/**
 * Lifts a suspension, back to DRAFT rather than straight to published.
 *
 * The owner decides when their store is public again, which is also what makes
 * reinstatement safe to perform: it restores the ability to publish rather
 * than publishing on somebody else's behalf.
 */
export async function reinstateStore(
  db: Database,
  actor: Actor,
  storeId: string,
): Promise<StoreRecord> {
  await authorize(db, actor, "store.moderate");

  const updated = await db.execute<StoreRow>(sql`
    update stores set status = 'draft', suspended_at = null, updated_at = now()
     where id = ${storeId}::uuid and status = 'suspended'
    returning ${STORE_COLUMNS}
  `);
  const row = updated.rows[0];
  if (row === undefined) {
    throw new NotPublishableError("That store is not suspended.");
  }

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "store.reinstated",
    targetType: "store", targetId: storeId, context: { slug: row.slug },
  });
  return toStore(row);
}

/** Takes a store out of public view at its OWNER's request. Back to draft. */
export async function unpublishStore(
  db: Database,
  actor: Actor,
  storeId: string,
): Promise<StoreRecord> {
  await authorize(db, actor, "store.update", { type: "store", id: storeId });

  const updated = await db.execute<StoreRow>(sql`
    update stores set status = 'draft', updated_at = now()
     where id = ${storeId}::uuid and status = 'published'
    returning ${STORE_COLUMNS}
  `);
  const row = updated.rows[0];
  if (row === undefined) {
    throw new NotPublishableError("That store is not published.");
  }

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "store.unpublished",
    targetType: "store", targetId: storeId, context: { slug: row.slug },
  });
  return toStore(row);
}

/** The stores this actor owns. Scoped to the actor in SQL, never filtered after. */
export async function listOwnStores(db: Database, actor: Actor): Promise<StoreRecord[]> {
  const rows = await db.execute<StoreRow>(sql`
    select ${STORE_COLUMNS} from stores where owner_user_id = ${actor.userId}::uuid
     order by created_at desc
  `);
  return rows.rows.map(toStore);
}

export async function findStoreBySlug(db: Database, slug: string): Promise<StoreRecord> {
  const rows = await db.execute<StoreRow>(sql`
    select ${STORE_COLUMNS} from stores where slug = ${slug}
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new StoreNotFoundError(slug);
  return toStore(row);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductRecord {
  readonly id: string;
  readonly storeId: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly price: Money;
  readonly status: "draft" | "published" | "archived";
  readonly publishedAt: Date | null;
}

interface ProductRow {
  [key: string]: unknown;
  id: string;
  store_id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  price_minor: string | bigint;
  currency: string;
  status: string;
  published_at: string | null;
}

function toProduct(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    // Straight from bigint minor units into the money type. There is no point
    // in this path where the amount is a JavaScript number.
    price: money(BigInt(row.price_minor), row.currency),
    status: row.status as ProductRecord["status"],
    publishedAt: row.published_at === null ? null : new Date(row.published_at),
  };
}

export interface CreateProductInput {
  readonly storeId: string;
  readonly title: string;
  readonly slug?: string | undefined;
  readonly summary?: string | undefined;
  readonly description?: string | undefined;
  readonly price: Money;
}

export async function createProduct(
  db: Database,
  actor: Actor,
  input: CreateProductInput,
): Promise<ProductRecord> {
  await authorize(db, actor, "product.create", { type: "store", id: input.storeId });

  const slug = input.slug ?? slugify(input.title);
  assertUsableSlug(slug, "product");

  if (input.price.amountMinor <= 0n) {
    throw new NotPublishableError("A paid product needs a price above zero.");
  }

  // Currencies are rows, not a union type in code. An inactive one is not a
  // pricing option, and the check belongs here rather than in a form.
  const currency = await db.execute<{ is_active: boolean }>(sql`
    select is_active from currencies where code = ${input.price.currency}
  `);
  if (currency.rows[0]?.is_active !== true) {
    throw new UnsupportedCurrencyError(input.price.currency);
  }

  const clash = await db.execute(sql`
    select 1 from products where store_id = ${input.storeId}::uuid and slug = ${slug}
  `);
  if (clash.rows.length > 0) throw new SlugTakenError(slug);

  const productId = uuidv7();
  await db.execute(sql`
    insert into products (id, store_id, slug, kind, title, summary, description,
                          price_minor, currency, status)
    values (${productId}, ${input.storeId}::uuid, ${slug}, 'digital', ${input.title},
            ${input.summary ?? null}, ${input.description ?? null},
            ${input.price.amountMinor.toString()}::bigint, ${input.price.currency}, 'draft')
  `);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.created",
    targetType: "product", targetId: productId,
    context: {
      storeId: input.storeId, slug,
      priceMinor: input.price.amountMinor.toString(), currency: input.price.currency,
    },
  });

  const created = await db.execute<ProductRow>(sql`
    select id, store_id, slug, title, summary, description, price_minor, currency,
           status, published_at
      from products where id = ${productId}
  `);
  return toProduct(created.rows[0]!);
}

/**
 * Makes a product publicly reachable.
 *
 * Refuses if the store is not published: a product whose store is still a draft
 * would otherwise have a live URL that the seller never intended to expose.
 * `published_at` is set in the same statement, because the database refuses the
 * status without it.
 */
export async function publishProduct(
  db: Database,
  actor: Actor,
  productId: string,
): Promise<ProductRecord> {
  const owning = await db.execute<{ store_id: string; store_status: string }>(sql`
    select p.store_id, s.status as store_status
      from products p join stores s on s.id = p.store_id
     where p.id = ${productId}::uuid
  `);
  const context = owning.rows[0];
  if (context === undefined) throw new ProductNotFoundError(productId);

  await authorize(db, actor, "product.publish", { type: "store", id: context.store_id });

  if (context.store_status !== "published") {
    throw new NotPublishableError(
      "Publish the store first — a product cannot be reachable through a store that is not.",
    );
  }

  /*
   * Publishing the product publishes its pending VERSION, and refuses if there
   * is nothing to publish.
   *
   * A digital product exists to deliver a file. One published with none would
   * take a buyer's money and hand back an empty page — which is the same
   * dishonesty as a placeholder file, arriving by omission instead. So the two
   * lifecycles are tied together here, in one place, rather than left to a
   * seller remembering to do both.
   *
   * The draft is only promoted if it actually has files: a version with none
   * would satisfy the letter of this rule and none of its purpose.
   */
  await db.execute(sql`
    update product_versions pv
       set status = 'published', published_at = now()
     where pv.product_id = ${productId}::uuid
       and pv.status = 'draft'
       and exists (select 1 from digital_assets a where a.version_id = pv.id)
  `);
  const deliverable = await db.execute(sql`
    select 1 from product_versions
     where product_id = ${productId}::uuid and status = 'published' limit 1
  `);
  if (deliverable.rows.length === 0) {
    throw new NotPublishableError(
      "Add a file before publishing — a buyer would receive nothing.",
    );
  }

  const updated = await db.execute<ProductRow>(sql`
    update products
       set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
     where id = ${productId}::uuid and status <> 'archived'
    returning id, store_id, slug, title, summary, description, price_minor, currency,
              status, published_at
  `);
  const row = updated.rows[0];
  if (row === undefined) throw new NotPublishableError("An archived product cannot be republished.");

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.published",
    targetType: "product", targetId: productId,
    context: { storeId: context.store_id, slug: row.slug },
  });
  return toProduct(row);
}

/** Everything in a store the actor may administer. Includes drafts. */
export async function listStoreProducts(
  db: Database,
  actor: Actor,
  storeId: string,
): Promise<ProductRecord[]> {
  await authorize(db, actor, "product.create", { type: "store", id: storeId });
  const rows = await db.execute<ProductRow>(sql`
    select id, store_id, slug, title, summary, description, price_minor, currency,
           status, published_at
      from products where store_id = ${storeId}::uuid
     order by created_at desc
  `);
  return rows.rows.map(toProduct);
}

// ---------------------------------------------------------------------------
// The public view
// ---------------------------------------------------------------------------

/**
 * What an anonymous visitor is allowed to see.
 *
 * A separate shape from `ProductRecord`, not a filtered copy of it: the owner's
 * user id, the store's internal id, draft state and timestamps have no business
 * on a public page, and the way to guarantee they never leak is for the public
 * type not to have the fields at all.
 */
export interface PublicProduct {
  readonly storeSlug: string;
  readonly storeName: string;
  readonly storeTagline: string | null;
  readonly slug: string;
  readonly title: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly price: Money;
}

interface PublicRow {
  [key: string]: unknown;
  store_slug: string;
  store_name: string;
  store_tagline: string | null;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  price_minor: string | bigint;
  currency: string;
}

function toPublic(row: PublicRow): PublicProduct {
  return {
    storeSlug: row.store_slug,
    storeName: row.store_name,
    storeTagline: row.store_tagline,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    price: money(BigInt(row.price_minor), row.currency),
  };
}

/**
 * Both conditions are in the WHERE clause, not applied after the read.
 *
 * A draft product, or one whose store is unpublished or suspended, is not
 * fetched-then-hidden: it is never selected. That is the same rule the rest of
 * the codebase follows for actor scoping, and it is what makes "we forgot to
 * check" impossible rather than unlikely.
 */
export async function findPublicProduct(
  db: Database,
  storeSlug: string,
  productSlug: string,
): Promise<PublicProduct | undefined> {
  const rows = await db.execute<PublicRow>(sql`
    select s.slug as store_slug, s.name as store_name, s.tagline as store_tagline,
           p.slug, p.title, p.summary, p.description, p.price_minor, p.currency
      from products p
      join stores s on s.id = p.store_id
     where s.slug = ${storeSlug}
       and p.slug = ${productSlug}
       and p.status = 'published'
       and s.status = 'published'
  `);
  const row = rows.rows[0];
  return row === undefined ? undefined : toPublic(row);
}

/** What an anonymous visitor may know about a store. */
export interface PublicStore {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string | null;
  readonly storeType: StoreType;
  readonly description: string | null;
  readonly brand: StoreBrand;
  readonly countryCode: string | null;
  readonly city: string | null;
  readonly contactPhone: string | null;
  readonly publishedAt: Date | null;
}

/**
 * A store's public identity, or nothing.
 *
 * Unpublished, suspended and non-existent are one answer on purpose: telling
 * them apart would let a stranger enumerate which slugs are taken and which
 * sellers are suspended.
 */
export async function findPublicStore(
  db: Database,
  storeSlug: string,
): Promise<PublicStore | undefined> {
  const rows = await db.execute<StoreRow>(sql`
    select ${STORE_COLUMNS} from stores where slug = ${storeSlug} and status = 'published'
  `);
  const row = rows.rows[0];
  if (row === undefined) return undefined;
  const store = toStore(row);
  /*
   * A deliberate projection, not a cast.
   *
   * `StoreRecord` carries the owner's user id and the internal store id.
   * Naming the public fields one by one is what stops a future field — an
   * internal note, a moderation flag — from reaching a stranger's browser
   * simply because somebody added a column.
   */
  return {
    slug: store.slug,
    name: store.name,
    tagline: store.tagline,
    storeType: store.storeType,
    description: store.description,
    brand: store.brand,
    countryCode: store.countryCode,
    city: store.city,
    contactPhone: store.contactPhone,
    publishedAt: store.publishedAt,
  };
}

/** A published store's published products. Same rule, same place. */
export async function listPublicProducts(
  db: Database,
  storeSlug: string,
): Promise<PublicProduct[]> {
  const rows = await db.execute<PublicRow>(sql`
    select s.slug as store_slug, s.name as store_name, s.tagline as store_tagline,
           p.slug, p.title, p.summary, p.description, p.price_minor, p.currency
      from products p
      join stores s on s.id = p.store_id
     where s.slug = ${storeSlug}
       and p.status = 'published'
       and s.status = 'published'
     order by p.published_at desc
  `);
  return rows.rows.map(toPublic);
}
