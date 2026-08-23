import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore, suspendStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { PermissionDeniedError } from "../errors";
import { money } from "../money";
import {
  applyProviderEvent, createCheckout, initiatePayment,
} from "../orders";
import { LAUNCH_PAYMENT_CHANNEL, MockPaymentProvider } from "../payments";
import { createTestUser, ensureReferenceData, expectRejection, resetData, testDb } from "../test/harness";
import {
  attachAsset, ContentForbiddenError, deriveContentKey, DownloadLimitReachedError,
  findEntitledProduct, grantContentAccess, InMemoryContentStorage, listEntitledProducts,
  listProductVersions, openContent, openDraftVersion, publicLicenceFor, publishVersion,
  revokeEntitlementsForOrder, setDownloadLimit, setDraftLicence, VersionEmptyError,
} from "./index";

/**
 * The digital product engine, from the position of somebody who wants the file
 * without having paid for it — and of a buyer whose seller changed the deal
 * after they paid.
 *
 * Every purchase here goes through the REAL path: checkout, charge, signed
 * provider event. An entitlement conjured by a fixture would prove only that
 * the access check reads a row; going through the payment boundary proves the
 * row exists when it should and not otherwise.
 */

const SECRET = "test-application-secret-0123456789abcdef";
const V1 = Buffer.from("%PDF-1.7\nversion one\n%%EOF\n", "utf8");
const V2 = Buffer.from("%PDF-1.7\nversion two, corrected\n%%EOF\n", "utf8");

let db: Database;
let storage: InMemoryContentStorage;
let provider: MockPaymentProvider;
let key: Buffer;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  storage = new InMemoryContentStorage();
  provider = new MockPaymentProvider();
  key = deriveContentKey(SECRET);
  await db.execute(sql`
    insert into commission_rules
      (id, transaction_type, rate_bps, currency, priority, effective_from)
    values (gen_random_uuid(), 'digital', 1800, 'XOF', 0, '2026-01-01T00:00:00Z')
  `);
});

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  const r = await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
  if (r.rowCount !== 1) throw new Error(`No role named "${roleKey}".`);
}

async function makeBuyer(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, { method: "signup" });
  return { userId };
}

async function makeSeller(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "seller");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, { method: "signup" });
  await acceptCurrentVersions(db, userId, ["seller_terms"], { locale: "fr" }, { method: "signup" });
  return { userId };
}

let counter = 0;

interface Listing {
  seller: Actor;
  storeId: string;
  storeSlug: string;
  productSlug: string;
  productId: string;
  assetId: string;
}

/** A published product with one file and, optionally, a licence and a limit. */
async function listing(
  options: { licence?: string; downloadLimit?: number; publish?: boolean } = {},
): Promise<Listing> {
  counter += 1;
  const seller = await makeSeller();
  const store = await createStore(db, seller, {
    storeType: "digital_product", name: `Boutique ${counter}`, slug: `boutique-${counter}`,
  });
  await publishStore(db, seller, store.id);
  const product = await createProduct(db, seller, {
    storeId: store.id, title: `Guide ${counter}`, slug: `guide-${counter}`,
    price: money(5000n, "XOF"),
  });

  const asset = await attachAsset(db, storage, seller, {
    productId: product.id, title: "Le guide (PDF)", contentType: "application/pdf", bytes: V1,
  });
  if (options.licence !== undefined) {
    await setDraftLicence(db, seller, product.id, options.licence);
  }
  if (options.downloadLimit !== undefined) {
    await setDownloadLimit(db, seller, product.id, options.downloadLimit);
  }
  if (options.publish !== false) await publishProduct(db, seller, product.id);

  return {
    seller, storeId: store.id, storeSlug: store.slug, productSlug: product.slug,
    productId: product.id, assetId: asset.id,
  };
}

/** Buys it for real, and returns the order id. */
async function buy(buyer: Actor, l: Listing): Promise<string> {
  counter += 1;
  const { order } = await createCheckout(db, buyer, {
    storeSlug: l.storeSlug, productSlug: l.productSlug, checkoutKey: `buy-${counter}`,
  });
  const payment = await initiatePayment(db, buyer, provider, {
    orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL,
  });
  const event = provider.event({
    id: `evt-${counter}`, providerRef: payment.providerRef as string,
    status: "succeeded", amountMinor: 5000n, currency: "XOF",
  });
  await applyProviderEvent(db, provider, event.body, event.headers);
  return order.id;
}

/** Grant, then spend it — the only path to bytes. */
async function download(actor: Actor, assetId: string) {
  const grant = await grantContentAccess(db, key, actor, assetId, "attachment");
  return openContent(db, storage, key, actor, grant.token);
}

// ===========================================================================

describe("versions are immutable once somebody could have paid for them", () => {
  it("keeps a buyer on the version they paid for when the seller publishes another",
    async () => {
      const l = await listing();
      const buyer = await makeBuyer();
      await buy(buyer, l);

      // The buyer has v1.
      expect((await download(buyer, l.assetId)).object.bytes.toString()).toBe(V1.toString());

      // The seller uploads a correction. It becomes version 2, and publishing
      // the version does NOT touch what version 1 contains.
      const v2Asset = await attachAsset(db, storage, l.seller, {
        productId: l.productId, title: "Le guide (corrigé)",
        contentType: "application/pdf", bytes: V2,
      });
      await publishVersion(db, l.seller, l.productId);

      const versions = await listProductVersions(db, l.seller, l.productId);
      expect(versions.map((v) => v.versionNo)).toEqual([2, 1]);
      expect(versions.every((v) => v.status === "published")).toBe(true);

      // The buyer still gets exactly what they bought.
      const after = await download(buyer, l.assetId);
      expect(after.object.bytes.toString(), "the purchased bytes are unchanged")
        .toBe(V1.toString());

      // And cannot reach the new version's file, which they did not buy.
      await expect(download(buyer, v2Asset.id)).rejects.toBeInstanceOf(ContentForbiddenError);

      const owned = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
      expect(owned?.versionNo, "the library names the purchased version").toBe(1);
      expect(owned?.assets.map((a) => a.id)).toEqual([l.assetId]);
    });

  it("refuses to change a published version's files, at the database", async () => {
    const l = await listing();

    // Directly, bypassing every domain function — this is the guarantee that
    // has to hold even against code that has not been written yet.
    const versionId = (await db.execute<{ [k: string]: unknown; id: string }>(sql`
      select id from product_versions where product_id = ${l.productId}::uuid
    `)).rows[0]!.id;

    // `expectRejection` walks the error's cause chain: drizzle wraps the
    // PostgreSQL message, and asserting on the wrapper would pass for any
    // failed query at all.
    await expectRejection(db.execute(sql`
      update digital_assets set title = 'swapped' where id = ${l.assetId}::uuid
    `), /published product version/);

    await expectRejection(db.execute(sql`
      delete from digital_assets where id = ${l.assetId}::uuid
    `), /published product version/);

    await expectRejection(db.execute(sql`
      update product_versions set licence_text = 'rewritten' where id = ${versionId}::uuid
    `), /immutable/);

    await expectRejection(db.execute(sql`
      delete from product_versions where id = ${versionId}::uuid
    `), /cannot be deleted/);
  });

  it("puts a new upload in a NEW draft, never into the published one", async () => {
    const l = await listing();
    const before = await listProductVersions(db, l.seller, l.productId);
    expect(before).toHaveLength(1);

    await attachAsset(db, storage, l.seller, {
      productId: l.productId, title: "second", contentType: "application/pdf", bytes: V2,
    });

    const after = await listProductVersions(db, l.seller, l.productId);
    expect(after.map((v) => `${v.versionNo}:${v.status}`)).toEqual(["2:draft", "1:published"]);
    expect(after.find((v) => v.versionNo === 1)?.assetCount,
      "version 1 still has exactly the file it was published with").toBe(1);
  });

  it("collects several uploads into ONE draft rather than a version each", async () => {
    const l = await listing();
    for (const title of ["a", "b", "c"]) {
      await attachAsset(db, storage, l.seller, {
        productId: l.productId, title, contentType: "application/pdf", bytes: V2,
      });
    }
    const versions = await listProductVersions(db, l.seller, l.productId);
    expect(versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(versions[0]?.assetCount).toBe(3);
  });

  /*
   * The mutation this exists for: inventing a placeholder file so that an
   * empty product can be published anyway.
   *
   * That would be worse than refusing — a buyer would pay 5 000 XOF and
   * receive a one-byte file called "Bientot disponible". So the assertion is
   * not merely that publication is refused, but that NO asset row appeared.
   */
  it("refuses to publish a product with no files, and invents none", async () => {
    counter += 1;
    const seller = await makeSeller();
    const store = await createStore(db, seller, {
      storeType: "digital_product", name: `Vide ${counter}`, slug: `vide-${counter}`,
    });
    await publishStore(db, seller, store.id);
    const product = await createProduct(db, seller, {
      storeId: store.id, title: "Rien", slug: `rien-${counter}`, price: money(5000n, "XOF"),
    });

    await expect(publishProduct(db, seller, product.id)).rejects.toThrow(/Add a file/);

    const assets = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(*) as n from digital_assets where product_id = ${product.id}::uuid
    `);
    expect(Number(assets.rows[0]?.n), "no placeholder was conjured").toBe(0);

    const versions = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(*) as n from product_versions
       where product_id = ${product.id}::uuid and status = 'published'
    `);
    expect(Number(versions.rows[0]?.n), "and no version was published").toBe(0);

    const stillDraft = await db.execute<{ [k: string]: unknown; status: string }>(sql`
      select status from products where id = ${product.id}::uuid
    `);
    expect(stillDraft.rows[0]?.status).toBe("draft");
  });

  it("refuses to publish a version with no files in it", async () => {
    const l = await listing();
    await openDraftVersion(db, l.seller, l.productId);
    await expect(publishVersion(db, l.seller, l.productId))
      .rejects.toBeInstanceOf(VersionEmptyError);
  });
});

// ===========================================================================

describe("the licence is the seller's, and is frozen at purchase", () => {
  it("shows the licence before purchase and freezes it after", async () => {
    const l = await listing({ licence: "Usage personnel. Pas de revente." });

    // Readable by anyone, because a term nobody can read before paying is not
    // a term.
    const shown = await publicLicenceFor(db, l.storeSlug, l.productSlug);
    expect(shown?.licenceText).toBe("Usage personnel. Pas de revente.");

    const buyer = await makeBuyer();
    await buy(buyer, l);

    // The seller rewrites the licence in a NEW version.
    await attachAsset(db, storage, l.seller, {
      productId: l.productId, title: "v2", contentType: "application/pdf", bytes: V2,
    });
    await setDraftLicence(db, l.seller, l.productId, "Revente autorisée. Tout change.");
    await publishVersion(db, l.seller, l.productId);

    expect((await publicLicenceFor(db, l.storeSlug, l.productSlug))?.licenceText,
      "a new buyer sees the new terms").toBe("Revente autorisée. Tout change.");

    const owned = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
    expect(owned?.licenceSnapshot,
      "the existing buyer keeps the terms they agreed to").toBe("Usage personnel. Pas de revente.");
  });

  it("invents no licence when the seller wrote none", async () => {
    const l = await listing();
    expect((await publicLicenceFor(db, l.storeSlug, l.productSlug))?.licenceText).toBeNull();

    const buyer = await makeBuyer();
    await buy(buyer, l);
    const owned = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
    expect(owned?.licenceSnapshot, "absent, not an invented default").toBeNull();
  });

  it("does not leak the licence of an unpublished product", async () => {
    const l = await listing({ licence: "secret terms", publish: false });
    expect(await publicLicenceFor(db, l.storeSlug, l.productSlug)).toBeUndefined();
  });
});

// ===========================================================================

describe("download limits are counted, not stored", () => {
  it("allows exactly the limit, then refuses with a reason the buyer has earned",
    async () => {
      const l = await listing({ downloadLimit: 2 });
      const buyer = await makeBuyer();
      await buy(buyer, l);

      const first = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
      expect(first?.assets[0]?.downloadsRemaining).toBe(2);

      await download(buyer, l.assetId);
      const mid = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
      expect(mid?.assets[0]?.downloadsRemaining).toBe(1);

      await download(buyer, l.assetId);
      const spent = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
      expect(spent?.assets[0]?.downloadsRemaining).toBe(0);

      /*
       * The third is refused, and this is the ONE content refusal allowed to
       * say what it means — the buyer has already proved a live entitlement to
       * this exact file, so "you have used your two downloads" is their own
       * information. A stranger is refused opaquely, one step earlier.
       */
      await expect(download(buyer, l.assetId))
        .rejects.toBeInstanceOf(DownloadLimitReachedError);
    });

  it("counts per file, so one file does not spend another's allowance", async () => {
    const l = await listing({ downloadLimit: 1 });
    // A second file, published as version 2, then bought fresh.
    const second = await attachAsset(db, storage, l.seller, {
      productId: l.productId, title: "annexe", contentType: "application/pdf", bytes: V2,
    });
    await attachAsset(db, storage, l.seller, {
      productId: l.productId, title: "principal", contentType: "application/pdf", bytes: V1,
    });
    await publishVersion(db, l.seller, l.productId);

    const buyer = await makeBuyer();
    await buy(buyer, l);

    await download(buyer, second.id);
    await expect(download(buyer, second.id)).rejects.toBeInstanceOf(DownloadLimitReachedError);

    // The other file of the same purchase still has its own allowance.
    const owned = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
    const other = owned!.assets.find((a) => a.id !== second.id)!;
    expect(other.downloadsRemaining).toBe(1);
    await expect(download(buyer, other.id)).resolves.toBeDefined();
  });

  it("has no counter to reset, because the log refuses to be erased", async () => {
    const l = await listing({ downloadLimit: 1 });
    const buyer = await makeBuyer();
    await buy(buyer, l);
    await download(buyer, l.assetId);

    // The obvious attack on a limit: wipe the history and start again.
    await expectRejection(db.execute(sql`delete from entitlement_downloads`), /append|immutable|not permitted|cannot/i);
    await expectRejection(db.execute(sql`
      update entitlement_downloads set downloaded_at = now() - interval '1 year'
    `), /append|immutable|not permitted|cannot/i);

    await expect(download(buyer, l.assetId))
      .rejects.toBeInstanceOf(DownloadLimitReachedError);
  });

  /*
   * The mutation this exists for: counting only TODAY's downloads.
   *
   * Every other test in this file downloads twice within a second, so a limit
   * that silently reset at midnight would pass all of them and then hand a
   * buyer unlimited copies from the second day onwards. The only way to catch
   * it is to have a download that is genuinely old — inserted with an old
   * timestamp, because the log is append-only and cannot be back-dated later.
   */
  it("counts every download ever, not just recent ones", async () => {
    const l = await listing({ downloadLimit: 2 });
    const buyer = await makeBuyer();
    await buy(buyer, l);

    const entitlementId = (await db.execute<{ [k: string]: unknown; id: string }>(sql`
      select id from entitlements where user_id = ${buyer.userId}::uuid
    `)).rows[0]!.id;

    // Two downloads from a year ago. They spent the allowance then, and they
    // still have.
    for (let i = 0; i < 2; i += 1) {
      await db.execute(sql`
        insert into entitlement_downloads (id, entitlement_id, asset_id, byte_size, downloaded_at)
        values (gen_random_uuid(), ${entitlementId}::uuid, ${l.assetId}::uuid, 100,
                now() - interval '1 year')
      `);
    }

    const owned = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
    expect(owned?.assets[0]?.downloadsRemaining,
      "an old download is still a download").toBe(0);
    await expect(download(buyer, l.assetId))
      .rejects.toBeInstanceOf(DownloadLimitReachedError);
  });

  it("treats no limit as unlimited, and says so rather than guessing a number",
    async () => {
      const l = await listing();
      const buyer = await makeBuyer();
      await buy(buyer, l);
      for (let i = 0; i < 5; i += 1) await download(buyer, l.assetId);

      const owned = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
      expect(owned?.downloadLimit).toBeNull();
      expect(owned?.assets[0]?.downloadsRemaining).toBeNull();
    });

  it("does not spend a download when the file could not be read", async () => {
    const l = await listing({ downloadLimit: 1 });
    const buyer = await makeBuyer();
    await buy(buyer, l);

    // Storage loses the object. The buyer's allowance must survive our fault.
    const storageKey = (await db.execute<{ [k: string]: unknown; storage_key: string }>(sql`
      select storage_key from digital_assets where id = ${l.assetId}::uuid
    `)).rows[0]!.storage_key;
    await storage.remove(storageKey);

    await expect(download(buyer, l.assetId)).rejects.toThrow();

    const owned = await findEntitledProduct(db, buyer, l.storeSlug, l.productSlug);
    expect(owned?.assets[0]?.downloadsRemaining,
      "a storage failure is not the buyer's download").toBe(1);
  });
});

// ===========================================================================

describe("the library shows what was bought, and only that", () => {
  it("lists a purchase and nothing else", async () => {
    const mine = await listing();
    const theirs = await listing();
    const buyer = await makeBuyer();
    const other = await makeBuyer();
    await buy(buyer, mine);
    await buy(other, theirs);

    const library = await listEntitledProducts(db, buyer);
    expect(library.map((e) => e.productSlug)).toEqual([mine.productSlug]);
    expect(library[0]?.storeSlug).toBe(mine.storeSlug);
    expect(library[0]?.versionNo).toBe(1);
    expect(library[0]?.assetCount).toBe(1);
    expect(library[0]?.price.amountMinor).toBe(5000n);
  });

  it("is empty for someone who bought nothing", async () => {
    await listing();
    expect(await listEntitledProducts(db, await makeBuyer())).toEqual([]);
  });

  it("drops a purchase whose product was unpublished, and whose store was suspended",
    async () => {
      const l = await listing();
      const buyer = await makeBuyer();
      await buy(buyer, l);
      expect(await listEntitledProducts(db, buyer)).toHaveLength(1);

      await db.execute(sql`
        update products set status = 'draft' where id = ${l.productId}::uuid
      `);
      expect(await listEntitledProducts(db, buyer),
        "an unpublished product is not readable, even by its buyer").toHaveLength(0);

      await db.execute(sql`
        update products set status = 'published' where id = ${l.productId}::uuid
      `);
      expect(await listEntitledProducts(db, buyer)).toHaveLength(1);

      const moderator = await makeBuyer();
      await grantGlobal(moderator.userId, "ops");
      await suspendStore(db, moderator, l.storeId, "Contenu signalé");
      expect(await listEntitledProducts(db, buyer),
        "a suspended store takes its files with it").toHaveLength(0);
      await expect(download(buyer, l.assetId)).rejects.toBeInstanceOf(ContentForbiddenError);
    });
});

// ===========================================================================

describe("a refunded buyer stops being entitled", () => {
  it("revokes the entitlements of the refunded order, and only those", async () => {
    const l = await listing();
    const buyer = await makeBuyer();
    const bystander = await makeBuyer();
    const orderId = await buy(buyer, l);
    await buy(bystander, l);

    await expect(download(buyer, l.assetId)).resolves.toBeDefined();

    const revoked = await revokeEntitlementsForOrder(db, orderId, "refund.succeeded");
    expect(revoked).toBe(1);

    await expect(download(buyer, l.assetId)).rejects.toBeInstanceOf(ContentForbiddenError);
    expect(await listEntitledProducts(db, buyer)).toEqual([]);

    // Somebody else's purchase of the same product is untouched.
    await expect(download(bystander, l.assetId)).resolves.toBeDefined();
    expect(await listEntitledProducts(db, bystander)).toHaveLength(1);
  });

  it("revokes once, however many times the refund is reported", async () => {
    const l = await listing();
    const buyer = await makeBuyer();
    const orderId = await buy(buyer, l);

    expect(await revokeEntitlementsForOrder(db, orderId, "refund.succeeded")).toBe(1);
    expect(await revokeEntitlementsForOrder(db, orderId, "refund.succeeded"),
      "a webhook delivered twice revokes once").toBe(0);
  });
});

// ===========================================================================

describe("nobody reaches a file they did not buy", () => {
  it("refuses a stranger, an unpaid buyer and another buyer's asset id", async () => {
    const l = await listing();
    const stranger = await makeBuyer();

    // Never checked out at all.
    await expect(download(stranger, l.assetId)).rejects.toBeInstanceOf(ContentForbiddenError);

    // Checked out but never paid.
    const unpaid = await makeBuyer();
    await createCheckout(db, unpaid, {
      storeSlug: l.storeSlug, productSlug: l.productSlug, checkoutKey: "unpaid-1",
    });
    await expect(download(unpaid, l.assetId),
      "an order is not a purchase").rejects.toBeInstanceOf(ContentForbiddenError);

    // A real buyer of a DIFFERENT product cannot use their session on this one.
    const otherListing = await listing();
    const otherBuyer = await makeBuyer();
    await buy(otherBuyer, otherListing);
    await expect(download(otherBuyer, l.assetId))
      .rejects.toBeInstanceOf(ContentForbiddenError);
  });

  it("refuses the seller their own buyer-only endpoint", async () => {
    const l = await listing();
    /*
     * The owner has every right to their file — through the SELLER path, which
     * is authorized on the store. What they must not get is a buyer's
     * entitlement they never purchased, because that would mean the buyer path
     * grants on ownership rather than on payment, and the next person to reuse
     * it would inherit that.
     */
    await expect(download(l.seller, l.assetId)).rejects.toBeInstanceOf(ContentForbiddenError);
  });

  it("refuses a guessed asset id, and answers identically to a real one", async () => {
    const l = await listing();
    const buyer = await makeBuyer();
    await buy(buyer, l);

    const invented = "01a02f23-0000-7000-8000-000000000000";
    const guessed = await grantContentAccess(db, key, buyer, invented, "attachment")
      .catch((e: unknown) => e);
    const notMine = await grantContentAccess(db, key, await makeBuyer(), l.assetId, "attachment")
      .catch((e: unknown) => e);

    expect(guessed).toBeInstanceOf(ContentForbiddenError);
    expect(notMine).toBeInstanceOf(ContentForbiddenError);
    expect((guessed as Error).message, "one message, so neither can be told apart")
      .toBe((notMine as Error).message);
  });

  it("never lets a caller name whose entitlement to use", async () => {
    const l = await listing();
    const buyer = await makeBuyer();
    await buy(buyer, l);
    const attacker = await makeBuyer();

    /*
     * The shape of an IDOR attempt. `grantContentAccess` takes an actor and an
     * asset id and nothing else — there is no user id, order id or entitlement
     * id parameter to smuggle, which is the point. Passing the victim's actor
     * would require already being them.
     */
    await expect(
      grantContentAccess(db, key, attacker, l.assetId, "attachment"),
    ).rejects.toBeInstanceOf(ContentForbiddenError);

    const stolen = await grantContentAccess(db, key, buyer, l.assetId, "attachment");
    await expect(
      openContent(db, storage, key, attacker, stolen.token),
      "a grant copied out of the buyer's browser is bound to the buyer",
    ).rejects.toBeInstanceOf(ContentForbiddenError);
  });
});

// ===========================================================================

describe("the seller's controls are the seller's", () => {
  it("refuses version and limit changes to anyone but the store", async () => {
    const l = await listing();
    const rival = await makeSeller();

    await expect(openDraftVersion(db, rival, l.productId))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(setDraftLicence(db, rival, l.productId, "mine now"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(setDownloadLimit(db, rival, l.productId, 1))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(publishVersion(db, rival, l.productId))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listProductVersions(db, rival, l.productId))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  /*
   * The IDOR shape, on the seller side: a store id smuggled into the input.
   *
   * `attachAsset` resolves the owning store from the PRODUCT row. If it ever
   * preferred a caller-supplied one, a seller could authorize against their own
   * store while writing a file into somebody else's product — which is a
   * one-line change and exactly the kind that survives review.
   */
  it("ignores a store id supplied by the caller", async () => {
    const victim = await listing();
    const rival = await makeSeller();
    const rivalStore = await createStore(db, rival, {
      storeType: "digital_product", name: "Rival", slug: "rival-store",
    });

    await expect(
      attachAsset(db, storage, rival, {
        productId: victim.productId,
        title: "smuggled", contentType: "application/pdf", bytes: V2,
        // Not part of the input type. It is here because the type system is
        // not on the wire, and the runtime must refuse it on its own.
        ...({ storeId: rivalStore.id } as Record<string, unknown>),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // And nothing was written into the victim's product.
    const versions = await listProductVersions(db, victim.seller, victim.productId);
    expect(versions.map((v) => v.versionNo), "no draft was opened by the attempt")
      .toEqual([1]);
  });

  it("refuses a product that does not exist the same way as one that is not theirs",
    async () => {
      const rival = await makeSeller();
      const invented = "01a02f23-0000-7000-8000-000000000001";
      await expect(openDraftVersion(db, rival, invented))
        .rejects.toBeInstanceOf(ContentForbiddenError);
    });

  it("refuses a download limit that is not a whole number of at least one", async () => {
    const l = await listing();
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(setDownloadLimit(db, l.seller, l.productId, bad)).rejects.toThrow();
    }
    // null is the valid way to say "no limit".
    await expect(setDownloadLimit(db, l.seller, l.productId, null)).resolves.toBeUndefined();
  });
});
