import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { DomainError } from "../errors";
import { ContentForbiddenError } from "./forbidden";
import { openDraftVersion } from "./versions";
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

export { ContentForbiddenError };

/**
 * The one refusal that is allowed to say what it means.
 *
 * Every other content refusal collapses into `ContentForbiddenError` so the
 * endpoint cannot be used to enumerate assets or other people's purchases. This
 * one is different because it is only reachable by somebody who has ALREADY
 * proved a live entitlement to this exact file: telling them they have used
 * their five downloads discloses a fact about their own purchase, to them. A
 * stranger never gets here — they are refused, opaquely, one step earlier.
 */
export class DownloadLimitReachedError extends DomainError {
  override readonly name = "DownloadLimitReachedError";
  constructor(readonly limit: number) {
    super(
      "content.download_limit_reached",
      `You have used all ${limit} downloads of this file.`,
    );
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

  /*
   * The file goes into the product's DRAFT version, never into a published one.
   *
   * This is what makes "a new upload never silently replaces a purchased file"
   * true rather than merely intended: an already-published version's file set
   * is frozen by a database trigger, so even a caller that tried to write
   * there would be refused by PostgreSQL rather than by this function.
   */
  const draft = await openDraftVersion(db, actor, input.productId);

  const assetId = uuidv7();
  // Generated, never composed from anything a caller supplied.
  const storageKey = `products/${input.productId}/${draft.id}/${assetId}`;
  assertUsableStorageKey(storageKey);

  await storage.put(storageKey, input.bytes, input.contentType);

  await db.execute(sql`
    insert into digital_assets (id, product_id, version_id, title, kind, content_type,
                                byte_size, checksum_sha256, storage_key, sort_order)
    values (${assetId}, ${input.productId}, ${draft.id}, ${input.title},
            ${input.kind ?? "document"},
            ${input.contentType}, ${String(input.bytes.byteLength)}, ${checksumOf(input.bytes)},
            ${storageKey},
            coalesce((select max(sort_order) + 1 from digital_assets
                       where version_id = ${draft.id}::uuid), 0))
  `);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.asset.attached",
    targetType: "product", targetId: input.productId,
    context: {
      assetId, versionId: draft.id,
      contentType: input.contentType, byteSize: input.bytes.byteLength,
    },
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

export interface EntitledAsset extends AssetRecord {
  /** `null` when the seller set no limit. Counted, never stored. */
  readonly downloadsRemaining: number | null;
}

export interface EntitledProduct {
  readonly productId: string;
  readonly title: string;
  readonly storeSlug: string;
  readonly productSlug: string;
  readonly deliveryMode: DeliveryMode;
  /** The version this buyer paid for — not the product's current head. */
  readonly versionNo: number;
  /** The licence as it read on the day they bought it. */
  readonly licenceSnapshot: string | null;
  readonly downloadLimit: number | null;
  readonly assets: readonly EntitledAsset[];
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
    entitlement_id: string;
    version_id: string | null;
    version_no: number | null;
    licence_snapshot: string | null;
    download_limit: number | null;
  }>(sql`
    select p.id as product_id, p.title, p.delivery_mode,
           e.id as entitlement_id, e.version_id, v.version_no,
           e.licence_snapshot, p.download_limit
      from entitlements e
      join products p on p.id = e.product_id
      join stores s on s.id = p.store_id
      left join product_versions v on v.id = e.version_id
     where e.user_id = ${actor.userId}::uuid
       and e.revoked_at is null
       and p.status = 'published'
       and s.status = 'published'
       and s.slug = ${storeSlug}
       and p.slug = ${productSlug}
  `);
  const row = rows.rows[0];
  if (row === undefined) return undefined;

  // Only the files of the version this person bought.
  const assets = await db.execute<AssetRow>(sql`
    select id, title, kind, content_type, byte_size, sort_order
      from digital_assets
     where version_id = ${row.version_id}::uuid
     order by sort_order
  `);

  const limit = row.download_limit === null ? null : Number(row.download_limit);
  const withRemaining = await Promise.all(
    assets.rows.map(async (a) => ({
      ...toAsset(a),
      downloadsRemaining: await downloadsRemaining(db, row.entitlement_id, a.id, limit),
    })),
  );

  return {
    productId: row.product_id,
    title: row.title,
    storeSlug,
    productSlug,
    deliveryMode: row.delivery_mode as DeliveryMode,
    versionNo: row.version_no === null ? 1 : Number(row.version_no),
    licenceSnapshot: row.licence_snapshot,
    downloadLimit: limit,
    assets: withRemaining,
  };
}

/**
 * Everything this actor may read. The library screen's only source.
 *
 * Note what is NOT a parameter: no user id, no order id, no "owned" flag. The
 * actor comes from the session and the entitlement is a join, so the only way
 * into this list is to have actually bought the thing. There is no argument a
 * caller can pass that widens it.
 */
export interface LibraryEntry {
  readonly productId: string;
  readonly title: string;
  readonly storeSlug: string;
  readonly storeName: string;
  readonly productSlug: string;
  readonly deliveryMode: DeliveryMode;
  readonly versionNo: number;
  readonly hasLicence: boolean;
  readonly downloadLimit: number | null;
  readonly assetCount: number;
  readonly grantedAt: Date;
  readonly price: { amountMinor: bigint; currency: string };
}

export async function listEntitledProducts(
  db: Database,
  actor: Actor,
): Promise<ReadonlyArray<LibraryEntry>> {
  await authorize(db, actor, "order.read_own");
  const rows = await db.execute<{
    [key: string]: unknown;
    product_id: string;
    title: string;
    store_slug: string;
    store_name: string;
    product_slug: string;
    delivery_mode: string;
    version_no: number | null;
    licence_snapshot: string | null;
    download_limit: number | null;
    asset_count: string;
    granted_at: Date | string;
    price_minor: string | bigint;
    currency: string;
  }>(sql`
    select p.id as product_id, p.title, s.slug as store_slug, s.name as store_name,
           p.slug as product_slug, p.delivery_mode, v.version_no, e.licence_snapshot,
           p.download_limit, e.granted_at, p.price_minor, p.currency,
           (select count(*) from digital_assets a where a.version_id = e.version_id)
             as asset_count
      from entitlements e
      join products p on p.id = e.product_id
      join stores s on s.id = p.store_id
      left join product_versions v on v.id = e.version_id
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
    storeName: r.store_name,
    productSlug: r.product_slug,
    deliveryMode: r.delivery_mode as DeliveryMode,
    versionNo: r.version_no === null ? 1 : Number(r.version_no),
    hasLicence: r.licence_snapshot !== null && r.licence_snapshot !== "",
    downloadLimit: r.download_limit === null ? null : Number(r.download_limit),
    assetCount: Number(r.asset_count),
    grantedAt: r.granted_at instanceof Date ? r.granted_at : new Date(r.granted_at),
    price: { amountMinor: BigInt(r.price_minor), currency: r.currency },
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
interface ResolvedAsset {
  readonly storageKey: string;
  readonly contentType: string;
  readonly title: string;
  readonly deliveryMode: DeliveryMode;
  readonly entitlementId: string;
  readonly downloadLimit: number | null;
}

async function resolveEntitledAsset(
  db: Database,
  actor: Actor,
  assetId: string,
): Promise<ResolvedAsset | undefined> {
  const rows = await db.execute<{
    [key: string]: unknown;
    storage_key: string;
    content_type: string;
    title: string;
    delivery_mode: string;
    entitlement_id: string;
    download_limit: number | null;
  }>(sql`
    select a.storage_key, a.content_type, a.title, p.delivery_mode,
           e.id as entitlement_id, p.download_limit
      from digital_assets a
      join products p on p.id = a.product_id
      join stores s on s.id = p.store_id
      join entitlements e on e.product_id = p.id
     where a.id = ${assetId}::uuid
       and e.user_id = ${actor.userId}::uuid
       and e.revoked_at is null
       -- The asset must belong to the version this buyer actually PAID for.
       -- Without this, publishing a new version would silently hand every past
       -- buyer the new files, and retiring one would take away what they bought.
       and a.version_id = e.version_id
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
        entitlementId: row.entitlement_id,
        downloadLimit: row.download_limit === null ? null : Number(row.download_limit),
      };
}

/**
 * How many downloads of one file this entitlement has left.
 *
 * Counted from `entitlement_downloads`, which is append-only and refuses DELETE
 * at the database. "Remaining" is therefore always `limit − facts` and never a
 * stored number somebody could reset: there is no counter to zero out, and
 * erasing the history is not a thing the schema permits.
 *
 * `null` means the seller set no limit.
 */
export async function downloadsRemaining(
  db: Database,
  entitlementId: string,
  assetId: string,
  limit: number | null,
): Promise<number | null> {
  if (limit === null) return null;
  const rows = await db.execute<{ [key: string]: unknown; n: string }>(sql`
    select count(*) as n from entitlement_downloads
     where entitlement_id = ${entitlementId}::uuid and asset_id = ${assetId}::uuid
  `);
  return Math.max(0, limit - Number(rows.rows[0]?.n ?? 0));
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

  /*
   * The limit is checked HERE, where the bytes are actually handed over, and
   * not at grant time.
   *
   * Checking it when the grant is minted would count intentions rather than
   * deliveries: a buyer who opens the page twice and downloads once would have
   * spent two. What the seller is limiting is how many times the file leaves
   * Afrinext, so that is what is counted.
   */
  const remaining = await downloadsRemaining(
    db, asset.entitlementId, claims.a, asset.downloadLimit,
  );
  if (remaining !== null && remaining <= 0) {
    log.warn("download limit reached", { actorUserId: actor.userId, assetId: claims.a });
    await audit(db, {
      actorKind: "user", actorUserId: actor.userId, action: "content.access.refused",
      targetType: "digital_asset", targetId: claims.a,
      context: { stage: "download_limit", limit: asset.downloadLimit },
    });
    throw new DownloadLimitReachedError(asset.downloadLimit!);
  }

  const object = await storage.open(asset.storageKey);

  /*
   * Recorded AFTER the bytes were successfully read, so a storage failure does
   * not spend one of the buyer's downloads. Append-only: there is no counter to
   * increment and none to reset.
   */
  await db.execute(sql`
    insert into entitlement_downloads (id, entitlement_id, asset_id, byte_size)
    values (${uuidv7()}, ${asset.entitlementId}::uuid, ${claims.a}::uuid,
            ${String(object.bytes.byteLength)})
  `);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "content.access.granted",
    targetType: "digital_asset", targetId: claims.a,
    context: {
      disposition: claims.d, byteSize: object.bytes.byteLength,
      remainingAfter: remaining === null ? null : remaining - 1,
    },
  });

  return { object, title: asset.title, disposition: claims.d };
}

/**
 * Revokes one entitlement.
 *
 * The mechanism. `revokeEntitlementsForOrder` below is the policy that calls
 * it, and the refund domain is what calls that.
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

/**
 * Revokes every entitlement granted by one order. Returns how many were live.
 *
 * Called when a refund reaches `succeeded` — that is, when the money provably
 * went back. Afrinext takes the position that a buyer who has been repaid is no
 * longer entitled to the goods; the file they already downloaded cannot be
 * recalled, but their continuing access can be, and is.
 *
 * Deliberately keyed on the ORDER rather than on a buyer and a product. A
 * refund is settled against an order, so this cannot revoke somebody else's
 * purchase of the same product by accident, and it needs no caller-supplied
 * user id to decide whose access ends.
 *
 * Idempotent: the `revoked_at is null` guard means a webhook delivered twice
 * revokes once and reports 0 the second time.
 */
export async function revokeEntitlementsForOrder(
  db: Database,
  orderId: string,
  reason: string,
): Promise<number> {
  const revoked = await db.execute<{ [key: string]: unknown; user_id: string; product_id: string }>(sql`
    update entitlements
       set revoked_at = now(), revoked_reason = ${reason}
     where order_id = ${orderId}::uuid and revoked_at is null
    returning user_id, product_id
  `);

  for (const row of revoked.rows) {
    await audit(db, {
      actorKind: "system", action: "content.entitlement.revoked",
      targetType: "product", targetId: row.product_id,
      context: { userId: row.user_id, orderId, reason },
    });
  }
  return revoked.rows.length;
}
