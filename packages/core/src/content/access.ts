import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { DomainError } from "../errors";
import { uuidv7 } from "../ids";
import { logger } from "../observability";
import {
  assertUsableStorageKey, checksumOf, type ContentStorage, type StoredObject,
} from "./storage";

/**
 * Who may read the bytes behind a paid product, and how that is decided.
 *
 * The rule is one sentence: **access is derived on the server from the
 * authenticated actor plus a live entitlement, and from nothing the client
 * says.** No entitlement id, product id, order id, user id or "payment
 * succeeded" flag sent by a caller is read. The only thing a client supplies is
 * which asset it wants, and even that is resolved through a query scoped to the
 * actor.
 *
 * Serving a byte requires THREE independent checks to pass, in this order:
 *
 *   1. a short-lived grant, signed by a key derived from the application
 *      secret, that has not expired;
 *   2. the session actor being the same person the grant was issued to;
 *   3. a fresh entitlement lookup in SQL — not a claim carried in the grant.
 *
 * The third is what makes the first two safe to exist. A grant is a
 * convenience, not an authority: a leaked one is useless to anybody else
 * because of (2), and useless to its owner after a revocation because of (3).
 */

const log = logger.child({ component: "content.access" });

export class ContentForbiddenError extends DomainError {
  override readonly name = "ContentForbiddenError";
  constructor() {
    /*
     * One message for every refusal.
     *
     * "No such asset", "not yours", "expired grant" and "revoked entitlement"
     * answer identically, so the endpoint cannot be used to learn which asset
     * ids exist or which products someone else owns. The real reason is
     * audited.
     */
    super("content.forbidden", "You do not have access to this content.");
  }
}

export class AssetTooLargeError extends DomainError {
  override readonly name = "AssetTooLargeError";
  constructor(limit: number) {
    super("content.too_large", `A digital asset must be ${limit} bytes or smaller.`);
  }
}

export class UnsupportedContentTypeError extends DomainError {
  override readonly name = "UnsupportedContentTypeError";
  constructor(contentType: string) {
    super("content.unsupported_type", `"${contentType}" is not an accepted content type.`);
  }
}

/**
 * What a seller may upload.
 *
 * An allow-list, not a deny-list. The bytes are served back to buyers from an
 * Afrinext origin, so an uploaded `text/html` would be stored XSS against our
 * own domain — the list is what stops that, and it is short because this
 * milestone sells documents.
 */
export const ACCEPTED_CONTENT_TYPES: ReadonlyArray<string> = [
  "application/pdf",
  "application/epub+zip",
  "application/zip",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/markdown",
];

/** 25 MiB. A guide, not a film — video is a later milestone with its own limits. */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** How long a content grant is good for. Short: it is a hand-off, not a session. */
export const GRANT_TTL_MS = 120_000;

export type Disposition = "inline" | "attachment";
export type DeliveryMode = "download" | "view_only";

/**
 * The signing key for content grants.
 *
 * Derived from the application secret rather than being it, so a grant
 * signature cannot be replayed against any other subsystem that also signs with
 * the secret — the same reasoning, and the same construction, as the OTP key.
 */
export function deriveContentKey(appSecret: string): Buffer {
  if (appSecret === "") {
    throw new Error("An application secret is required to derive the content key.");
  }
  return Buffer.from(hkdfSync("sha256", appSecret, "", "afrinext:content:v1", 32));
}

export interface ContentGrant {
  readonly token: string;
  readonly assetId: string;
  readonly disposition: Disposition;
  readonly expiresAt: Date;
}

interface GrantClaims {
  readonly v: 1;
  readonly u: string;
  readonly a: string;
  readonly d: Disposition;
  readonly e: number;
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function encode(key: Buffer, claims: GrantClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(key, payload)}`;
}

/**
 * Verifies a grant, in constant time, without believing anything inside it yet.
 *
 * A verified grant says only "Afrinext issued this, to this person, for this
 * asset, and it has not expired". Whether that person may still read the asset
 * is a separate question answered against the database.
 */
function decode(key: Buffer, token: string, now: number): GrantClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 2) return undefined;
  const [payload, signature] = parts as [string, string];

  const expected = Buffer.from(sign(key, payload), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;

  let claims: GrantClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GrantClaims;
  } catch {
    return undefined;
  }
  if (claims.v !== 1 || typeof claims.u !== "string" || typeof claims.a !== "string") {
    return undefined;
  }
  if (typeof claims.e !== "number" || claims.e <= now) return undefined;
  return claims;
}

export interface AssetRecord {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sortOrder: number;
}

interface AssetRow {
  [key: string]: unknown;
  id: string;
  title: string;
  kind: string;
  content_type: string;
  byte_size: string | bigint;
  sort_order: number;
}

function toAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    sortOrder: Number(row.sort_order),
  };
}

// ---------------------------------------------------------------------------
// The seller's side
// ---------------------------------------------------------------------------

export interface AttachAssetInput {
  readonly productId: string;
  readonly title: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly kind?: "document" | "file";
}

/**
 * Attaches a file to a product.
 *
 * Authorized against the product's STORE scope, resolved from the product row
 * here rather than taken from the caller — a store id in the request would be a
 * store id an attacker could change.
 */
export async function attachAsset(
  db: Database,
  storage: ContentStorage,
  actor: Actor,
  input: AttachAssetInput,
): Promise<AssetRecord> {
  const owning = await db.execute<{ store_id: string }>(sql`
    select store_id from products where id = ${input.productId}::uuid
  `);
  const storeId = owning.rows[0]?.store_id;
  // Same answer for "no such product" as for "not your product": which product
  // ids exist is not something a stranger should be able to probe.
  if (storeId === undefined) throw new ContentForbiddenError();

  await authorize(db, actor, "product.manage_content", { type: "store", id: storeId });

  if (!ACCEPTED_CONTENT_TYPES.includes(input.contentType)) {
    throw new UnsupportedContentTypeError(input.contentType);
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ASSET_BYTES) {
    throw new AssetTooLargeError(MAX_ASSET_BYTES);
  }

  const assetId = uuidv7();
  // Generated, never composed from anything a caller supplied.
  const storageKey = `products/${input.productId}/${assetId}`;
  assertUsableStorageKey(storageKey);

  await storage.put(storageKey, input.bytes, input.contentType);

  await db.execute(sql`
    insert into digital_assets (id, product_id, title, kind, content_type, byte_size,
                                checksum_sha256, storage_key, sort_order)
    values (${assetId}, ${input.productId}, ${input.title}, ${input.kind ?? "document"},
            ${input.contentType}, ${String(input.bytes.byteLength)}, ${checksumOf(input.bytes)},
            ${storageKey},
            coalesce((select max(sort_order) + 1 from digital_assets
                       where product_id = ${input.productId}::uuid), 0))
  `);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.asset.attached",
    targetType: "product", targetId: input.productId,
    context: { assetId, contentType: input.contentType, byteSize: input.bytes.byteLength },
  });

  const stored = await db.execute<AssetRow>(sql`
    select id, title, kind, content_type, byte_size, sort_order
      from digital_assets where id = ${assetId}::uuid
  `);
  return toAsset(stored.rows[0]!);
}

/** A seller's own view of what is attached. Scoped to the store, in SQL. */
export async function listProductAssets(
  db: Database,
  actor: Actor,
  productId: string,
): Promise<AssetRecord[]> {
  const owning = await db.execute<{ store_id: string }>(sql`
    select store_id from products where id = ${productId}::uuid
  `);
  const storeId = owning.rows[0]?.store_id;
  if (storeId === undefined) throw new ContentForbiddenError();
  await authorize(db, actor, "product.manage_content", { type: "store", id: storeId });

  const rows = await db.execute<AssetRow>(sql`
    select id, title, kind, content_type, byte_size, sort_order
      from digital_assets where product_id = ${productId}::uuid order by sort_order
  `);
  return rows.rows.map(toAsset);
}

// ---------------------------------------------------------------------------
// The buyer's side
// ---------------------------------------------------------------------------

export interface EntitledProduct {
  readonly productId: string;
  readonly title: string;
  readonly storeSlug: string;
  readonly productSlug: string;
  readonly deliveryMode: DeliveryMode;
  readonly assets: readonly AssetRecord[];
}

/*
 * Every read below carries the same four conditions in its WHERE clause, and
 * none of them is applied after the read: the entitlement belongs to THIS
 * actor, it has not been revoked, the product is published, and its store is
 * published. A product the seller has since unpublished stops being readable on
 * the next request, which is the behaviour a takedown needs.
 *
 * They are repeated rather than factored into a shared fragment on purpose:
 * this is the security predicate, and a reader checking it should see it in
 * full at each site rather than have to go and look it up.
 */

export async function findEntitledProduct(
  db: Database,
  actor: Actor,
  storeSlug: string,
  productSlug: string,
): Promise<EntitledProduct | undefined> {
  await authorize(db, actor, "order.read_own");

  const rows = await db.execute<{
    [key: string]: unknown;
    product_id: string;
    title: string;
    delivery_mode: string;
  }>(sql`
    select p.id as product_id, p.title, p.delivery_mode
      from entitlements e
      join products p on p.id = e.product_id
      join stores s on s.id = p.store_id
     where e.user_id = ${actor.userId}::uuid
       and e.revoked_at is null
       and p.status = 'published'
       and s.status = 'published'
       and s.slug = ${storeSlug}
       and p.slug = ${productSlug}
  `);
  const row = rows.rows[0];
  if (row === undefined) return undefined;

  const assets = await db.execute<AssetRow>(sql`
    select id, title, kind, content_type, byte_size, sort_order
      from digital_assets where product_id = ${row.product_id}::uuid order by sort_order
  `);

  return {
    productId: row.product_id,
    title: row.title,
    storeSlug,
    productSlug,
    deliveryMode: row.delivery_mode as DeliveryMode,
    assets: assets.rows.map(toAsset),
  };
}

/** Everything this actor may read. The library screen's only source. */
export async function listEntitledProducts(
  db: Database,
  actor: Actor,
): Promise<ReadonlyArray<Omit<EntitledProduct, "assets"> & { assetCount: number; grantedAt: Date }>> {
  await authorize(db, actor, "order.read_own");
  const rows = await db.execute<{
    [key: string]: unknown;
    product_id: string;
    title: string;
    store_slug: string;
    product_slug: string;
    delivery_mode: string;
    asset_count: string;
    granted_at: Date | string;
  }>(sql`
    select p.id as product_id, p.title, s.slug as store_slug, p.slug as product_slug,
           p.delivery_mode, e.granted_at,
           (select count(*) from digital_assets a where a.product_id = p.id) as asset_count
      from entitlements e
      join products p on p.id = e.product_id
      join stores s on s.id = p.store_id
     where e.user_id = ${actor.userId}::uuid
       and e.revoked_at is null
       and p.status = 'published'
       and s.status = 'published'
     order by e.granted_at desc
  `);
  return rows.rows.map((r) => ({
    productId: r.product_id,
    title: r.title,
    storeSlug: r.store_slug,
    productSlug: r.product_slug,
    deliveryMode: r.delivery_mode as DeliveryMode,
    assetCount: Number(r.asset_count),
    grantedAt: r.granted_at instanceof Date ? r.granted_at : new Date(r.granted_at),
  }));
}

/**
 * Resolves one asset for one actor, or refuses.
 *
 * The asset id arrives from the client, and this is the query that makes that
 * safe: it joins from the asset to its product to the entitlement for THIS
 * actor. Another buyer's asset id, a draft product's asset id and an id that
 * does not exist all resolve to nothing, and all produce the same refusal.
 */
async function resolveEntitledAsset(
  db: Database,
  actor: Actor,
  assetId: string,
): Promise<{ storageKey: string; contentType: string; title: string; deliveryMode: DeliveryMode } | undefined> {
  const rows = await db.execute<{
    [key: string]: unknown;
    storage_key: string;
    content_type: string;
    title: string;
    delivery_mode: string;
  }>(sql`
    select a.storage_key, a.content_type, a.title, p.delivery_mode
      from digital_assets a
      join products p on p.id = a.product_id
      join stores s on s.id = p.store_id
      join entitlements e on e.product_id = p.id
     where a.id = ${assetId}::uuid
       and e.user_id = ${actor.userId}::uuid
       and e.revoked_at is null
       and p.status = 'published'
       and s.status = 'published'
  `);
  const row = rows.rows[0];
  return row === undefined
    ? undefined
    : {
        storageKey: row.storage_key,
        contentType: row.content_type,
        title: row.title,
        deliveryMode: row.delivery_mode as DeliveryMode,
      };
}

/**
 * Issues a short-lived grant for one asset.
 *
 * The entitlement is checked HERE, and again when the grant is spent. Checking
 * twice is not belt and braces for its own sake: a grant lives for two minutes,
 * and an entitlement revoked inside those two minutes must stop working
 * immediately rather than at expiry.
 */
export async function grantContentAccess(
  db: Database,
  key: Buffer,
  actor: Actor,
  assetId: string,
  disposition: Disposition,
  now: number = Date.now(),
): Promise<ContentGrant> {
  await authorize(db, actor, "order.read_own");

  const asset = await resolveEntitledAsset(db, actor, assetId);
  if (asset === undefined) {
    log.warn("content grant refused", { actorUserId: actor.userId, assetId });
    await audit(db, {
      actorKind: "user", actorUserId: actor.userId, action: "content.access.refused",
      targetType: "digital_asset", targetId: assetId,
      context: { stage: "grant" },
    });
    throw new ContentForbiddenError();
  }

  /*
   * A view-only product does not get an attachment grant.
   *
   * Refused at issuance rather than quietly downgraded, so a client asking for
   * the wrong thing is told, and so the seller's policy is a decision the
   * server makes rather than a header the client picks.
   */
  const effective: Disposition =
    asset.deliveryMode === "view_only" ? "inline" : disposition;
  if (asset.deliveryMode === "view_only" && disposition === "attachment") {
    throw new ContentForbiddenError();
  }

  const expiresAt = now + GRANT_TTL_MS;
  const token = encode(key, {
    v: 1, u: actor.userId, a: assetId, d: effective, e: expiresAt,
  });

  return { token, assetId, disposition: effective, expiresAt: new Date(expiresAt) };
}

export interface OpenedContent {
  readonly object: StoredObject;
  readonly title: string;
  readonly disposition: Disposition;
}

/**
 * Spends a grant and returns the bytes. The only path to a protected file.
 *
 * Three checks, and each one is independently sufficient to refuse:
 *
 *   1. the grant verifies and has not expired;
 *   2. `actor.userId` equals the subject the grant was issued to — so a grant
 *      copied out of one person's browser and pasted into another's session is
 *      refused, and a grant with no session at all never gets here because the
 *      route resolves an actor first;
 *   3. the entitlement still exists, is not revoked, and the product is still
 *      published — read from the database, not from the grant.
 */
export async function openContent(
  db: Database,
  storage: ContentStorage,
  key: Buffer,
  actor: Actor,
  token: string,
  now: number = Date.now(),
): Promise<OpenedContent> {
  const refuse = async (stage: string, assetId?: string): Promise<never> => {
    log.warn("content access refused", { actorUserId: actor.userId, stage });
    await audit(db, {
      actorKind: "user", actorUserId: actor.userId, action: "content.access.refused",
      targetType: "digital_asset", ...(assetId !== undefined ? { targetId: assetId } : {}),
      context: { stage },
    });
    throw new ContentForbiddenError();
  };

  const claims = decode(key, token, now);
  if (claims === undefined) return refuse("grant_invalid");
  if (claims.u !== actor.userId) return refuse("subject_mismatch", claims.a);

  const asset = await resolveEntitledAsset(db, actor, claims.a);
  if (asset === undefined) return refuse("entitlement_missing", claims.a);

  const object = await storage.open(asset.storageKey);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "content.access.granted",
    targetType: "digital_asset", targetId: claims.a,
    context: { disposition: claims.d, byteSize: object.bytes.byteLength },
  });

  return { object, title: asset.title, disposition: claims.d };
}

/**
 * Revokes an entitlement. Not called by anything in this milestone.
 *
 * Refunds are out of scope, and inventing a rule about when access should end
 * would be inventing a refund policy. What exists here is the mechanism, so
 * that when that decision is taken it is a call site rather than a migration —
 * and so that "a revoked entitlement grants nothing" is testable today.
 */
export async function revokeEntitlement(
  db: Database,
  userId: string,
  productId: string,
  reason: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    update entitlements set revoked_at = now(), revoked_reason = ${reason}
     where user_id = ${userId}::uuid and product_id = ${productId}::uuid and revoked_at is null
  `);
  const revoked = (result.rowCount ?? 0) > 0;
  if (revoked) {
    await audit(db, {
      actorKind: "system", action: "content.entitlement.revoked",
      targetType: "product", targetId: productId,
      context: { userId, reason },
    });
  }
  return revoked;
}
