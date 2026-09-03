import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { DomainError } from "../errors";
import { uuidv7 } from "../ids";
import { ContentForbiddenError } from "./forbidden";

/**
 * Versions of a digital product's payload.
 *
 * The problem this exists for: a buyer pays for a file, and the seller later
 * uploads a corrected one. Whatever else happens, the bytes that buyer paid for
 * and the terms they agreed to must still be exactly what they were when money
 * moved. A receipt that can be edited afterwards is not a receipt.
 *
 * So the model is:
 *
 *   - a product has one or more VERSIONS, numbered from 1;
 *   - files and licence text belong to a version, never to the product;
 *   - a version is editable while `draft` and **immutable once published** —
 *     enforced by database triggers, not by these functions;
 *   - an entitlement names the version it bought, so a buyer keeps what they
 *     paid for no matter what the seller publishes next.
 *
 * A new upload therefore never replaces a purchased file. It goes into the
 * draft version, and becomes real when the seller publishes it.
 */

export class VersionNotEditableError extends DomainError {
  override readonly name = "VersionNotEditableError";
  constructor() {
    super(
      "content.version_not_editable",
      "This version has been published. Create a new version to make changes.",
    );
  }
}

export class VersionEmptyError extends DomainError {
  override readonly name = "VersionEmptyError";
  constructor() {
    super(
      "content.version_empty",
      "Add at least one file before publishing this version.",
    );
  }
}

export class InvalidDownloadLimitError extends DomainError {
  override readonly name = "InvalidDownloadLimitError";
  constructor() {
    super(
      "content.download_limit_invalid",
      "A download limit must be a whole number of at least 1, or none at all.",
    );
  }
}

export interface ProductVersion {
  readonly id: string;
  readonly productId: string;
  readonly versionNo: number;
  readonly licenceText: string | null;
  readonly status: "draft" | "published";
  readonly publishedAt: Date | null;
  readonly assetCount: number;
}

interface VersionRow {
  [key: string]: unknown;
  id: string;
  product_id: string;
  version_no: number;
  licence_text: string | null;
  status: string;
  published_at: Date | string | null;
  asset_count: string | number;
}

function toVersion(row: VersionRow): ProductVersion {
  return {
    id: row.id,
    productId: row.product_id,
    versionNo: Number(row.version_no),
    licenceText: row.licence_text,
    status: row.status as "draft" | "published",
    publishedAt:
      row.published_at === null
        ? null
        : row.published_at instanceof Date
          ? row.published_at
          : new Date(row.published_at),
    assetCount: Number(row.asset_count),
  };
}

const VERSION_SELECT = sql`
  v.id, v.product_id, v.version_no, v.licence_text, v.status, v.published_at,
  (select count(*) from digital_assets a where a.version_id = v.id) as asset_count
`;

/**
 * Resolves the store a product belongs to, for authorization.
 *
 * The store id is read from the product row rather than taken from the caller.
 * A store id in a request would be a store id an attacker could change, and
 * "no such product" answers the same as "not your product" so which product ids
 * exist is not something a stranger can probe.
 */
async function storeScopeOf(db: Database, productId: string): Promise<string> {
  const rows = await db.execute<{ store_id: string }>(sql`
    select store_id from products where id = ${productId}::uuid
  `);
  const storeId = rows.rows[0]?.store_id;
  if (storeId === undefined) throw new ContentForbiddenError();
  return storeId;
}

/**
 * The product's open draft version, creating one if there is none.
 *
 * Idempotent by design: a seller uploading three files in a row gets one draft
 * version with three files in it, not three versions with one file each. The
 * partial unique index `product_versions_one_draft` is what makes that safe
 * under a double-click — a second concurrent insert is refused by the database
 * rather than racing to a second draft.
 */
export async function openDraftVersion(
  db: Database,
  actor: Actor,
  productId: string,
): Promise<ProductVersion> {
  const storeId = await storeScopeOf(db, productId);
  await authorize(db, actor, "product.manage_content", { type: "store", id: storeId });

  const existing = await db.execute<VersionRow>(sql`
    select ${VERSION_SELECT} from product_versions v
     where v.product_id = ${productId}::uuid and v.status = 'draft'
  `);
  const open = existing.rows[0];
  if (open !== undefined) return toVersion(open);

  /*
   * The new draft inherits the licence of the latest published version.
   *
   * A seller correcting a typo in a file has not changed their terms, and
   * making them retype the licence every time is how a licence ends up
   * accidentally blank. They can still edit it before publishing.
   */
  const versionId = uuidv7();
  await db.execute(sql`
    insert into product_versions (id, product_id, version_no, licence_text, status)
    select ${versionId}, ${productId}::uuid,
           coalesce((select max(version_no) from product_versions
                      where product_id = ${productId}::uuid), 0) + 1,
           (select licence_text from product_versions
             where product_id = ${productId}::uuid and status = 'published'
             order by version_no desc limit 1),
           'draft'
  `);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.version.opened",
    targetType: "product", targetId: productId, context: { versionId },
  });

  const created = await db.execute<VersionRow>(sql`
    select ${VERSION_SELECT} from product_versions v where v.id = ${versionId}::uuid
  `);
  return toVersion(created.rows[0]!);
}

/**
 * Sets the licence text on the DRAFT version.
 *
 * Afrinext supplies no default licence and makes no legal claim of its own:
 * these are the seller's own words, and an absent licence is absent rather than
 * implied. Editing a published version is refused here and, independently, by a
 * database trigger.
 */
export async function setDraftLicence(
  db: Database,
  actor: Actor,
  productId: string,
  licenceText: string | null,
): Promise<ProductVersion> {
  const draft = await openDraftVersion(db, actor, productId);

  const text = licenceText === null ? null : licenceText.trim();
  const updated = await db.execute(sql`
    update product_versions
       set licence_text = ${text === "" ? null : text}
     where id = ${draft.id}::uuid and status = 'draft'
  `);
  if ((updated.rowCount ?? 0) === 0) throw new VersionNotEditableError();

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.version.licence_set",
    targetType: "product", targetId: productId,
    // The licence text itself is the seller's content, not audit metadata.
    context: { versionId: draft.id, licencePresent: text !== null && text !== "" },
  });

  const rows = await db.execute<VersionRow>(sql`
    select ${VERSION_SELECT} from product_versions v where v.id = ${draft.id}::uuid
  `);
  return toVersion(rows.rows[0]!);
}

/**
 * Publishes the draft version, making it the one new buyers receive.
 *
 * Refuses an empty version. A version with no files would sell a buyer nothing
 * and there is no honest way to render that — the seller is told before anyone
 * pays, not after.
 */
export async function publishVersion(
  db: Database,
  actor: Actor,
  productId: string,
): Promise<ProductVersion> {
  const storeId = await storeScopeOf(db, productId);
  await authorize(db, actor, "product.manage_content", { type: "store", id: storeId });

  const draftRows = await db.execute<VersionRow>(sql`
    select ${VERSION_SELECT} from product_versions v
     where v.product_id = ${productId}::uuid and v.status = 'draft'
  `);
  const draft = draftRows.rows[0];
  if (draft === undefined) throw new VersionNotEditableError();
  if (Number(draft.asset_count) === 0) throw new VersionEmptyError();

  const moved = await db.execute(sql`
    update product_versions set status = 'published', published_at = now()
     where id = ${draft.id}::uuid and status = 'draft'
  `);
  if ((moved.rowCount ?? 0) === 0) throw new VersionNotEditableError();

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.version.published",
    targetType: "product", targetId: productId,
    context: { versionId: draft.id, versionNo: Number(draft.version_no) },
  });

  const rows = await db.execute<VersionRow>(sql`
    select ${VERSION_SELECT} from product_versions v where v.id = ${draft.id}::uuid
  `);
  return toVersion(rows.rows[0]!);
}

/** Every version of a product, newest first. The seller's own view. */
export async function listProductVersions(
  db: Database,
  actor: Actor,
  productId: string,
): Promise<ProductVersion[]> {
  const storeId = await storeScopeOf(db, productId);
  await authorize(db, actor, "product.manage_content", { type: "store", id: storeId });

  const rows = await db.execute<VersionRow>(sql`
    select ${VERSION_SELECT} from product_versions v
     where v.product_id = ${productId}::uuid
     order by v.version_no desc
  `);
  return rows.rows.map(toVersion);
}

/**
 * The version a purchase made right now would be pinned to.
 *
 * Deliberately takes no actor: this is a fact about the product, read on the
 * payment path where the buyer is not the one asking. It returns `undefined`
 * for a product with nothing published, and the caller decides what that means.
 */
export async function currentPublishedVersion(
  db: Database,
  productId: string,
): Promise<ProductVersion | undefined> {
  const rows = await db.execute<VersionRow>(sql`
    select ${VERSION_SELECT} from product_versions v
     where v.product_id = ${productId}::uuid and v.status = 'published'
     order by v.version_no desc limit 1
  `);
  const row = rows.rows[0];
  return row === undefined ? undefined : toVersion(row);
}

/**
 * The licence a buyer would be agreeing to, for display before purchase.
 *
 * Public: it is a term of sale, and terms nobody can read before paying are not
 * terms. Resolved through the published product and published store, so an
 * unpublished product's licence is not readable either.
 */
export async function publicLicenceFor(
  db: Database,
  storeSlug: string,
  productSlug: string,
): Promise<{ versionNo: number; licenceText: string | null } | undefined> {
  const rows = await db.execute<{
    [key: string]: unknown; version_no: number; licence_text: string | null;
  }>(sql`
    select v.version_no, v.licence_text
      from product_versions v
      join products p on p.id = v.product_id
      join stores s on s.id = p.store_id
     where s.slug = ${storeSlug} and p.slug = ${productSlug}
       and v.status = 'published'
       and p.status = 'published'
       and s.status = 'published'
     order by v.version_no desc limit 1
  `);
  const row = rows.rows[0];
  return row === undefined
    ? undefined
    : { versionNo: Number(row.version_no), licenceText: row.licence_text };
}

/**
 * Sets how many times a buyer may download each file of this product.
 *
 * `null` is unlimited. The limit is per file per buyer: a three-file product
 * should not exhaust its allowance by being fetched once.
 *
 * Changing it later changes what remains for existing buyers, because the
 * remaining count is `limit − downloads so far` and the downloads are facts.
 * Lowering it can therefore take a buyer to zero — which is why it is audited.
 */
export async function setDownloadLimit(
  db: Database,
  actor: Actor,
  productId: string,
  limit: number | null,
): Promise<void> {
  const storeId = await storeScopeOf(db, productId);
  await authorize(db, actor, "product.manage_content", { type: "store", id: storeId });

  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new InvalidDownloadLimitError();
  }

  await db.execute(sql`
    update products set download_limit = ${limit}, updated_at = now()
     where id = ${productId}::uuid
  `);

  await audit(db, {
    actorKind: "user", actorUserId: actor.userId, action: "product.download_limit_set",
    targetType: "product", targetId: productId, context: { limit },
  });
}
