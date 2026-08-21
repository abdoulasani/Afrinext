import { sql } from "drizzle-orm";
import { LAUNCH_PAYMENT_CHANNEL } from "../payments";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { PermissionDeniedError } from "../errors";
import { money } from "../money";
import {
  applyProviderEvent, createCheckout, DEFAULT_LATE_PAYMENT_GRACE_SECONDS,
  expireLapsedOrders, initiatePayment,
} from "../orders";
import { MockPaymentProvider } from "../payments";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import {
  ACCEPTED_CONTENT_TYPES, AssetTooLargeError, attachAsset, ContentForbiddenError,
  deriveContentKey, findEntitledProduct, GRANT_TTL_MS, grantContentAccess,
  InMemoryContentStorage, InvalidStorageKeyError, listEntitledProducts,
  listProductAssets, MAX_ASSET_BYTES, openContent, revokeEntitlement,
  UnsupportedContentTypeError, assertUsableStorageKey, FilesystemContentStorage,
} from "./index";

/**
 * Digital delivery, from the position of someone who wants the file without
 * having paid for it.
 *
 * Every test here goes through the REAL purchase path — checkout, charge,
 * signed provider event — rather than inserting an entitlement. An entitlement
 * conjured by a fixture would prove that the access check reads a row; going
 * through the payment boundary proves that the row only exists when it should.
 */

const SECRET = "test-application-secret-0123456789abcdef";
const PDF = Buffer.from("%PDF-1.7\nle guide de Niamey\n%%EOF\n", "utf8");

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

async function rejectsWith(
  promise: Promise<unknown>,
  expected: new (...args: never[]) => Error,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(expected);
}

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

async function makeBuyer(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  return { userId };
}

async function makeSeller(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "seller");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  await acceptCurrentVersions(db, userId, ["seller_terms"], { locale: "fr" }, { method: "signup" });
  return { userId };
}

let counter = 0;

interface Listing {
  seller: Actor;
  storeSlug: string;
  productSlug: string;
  productId: string;
  assetId: string;
  priceMinor: bigint;
}

/** A published product with a file attached, exactly as a seller would build it. */
async function publishedWithAsset(
  options: { deliveryMode?: "download" | "view_only"; publish?: boolean } = {},
): Promise<Listing> {
  counter += 1;
  const seller = await makeSeller();
  const store = await createStore(db, seller, {
    name: `Boutique ${counter}`, slug: `boutique-${counter}`,
  });
  await publishStore(db, seller, store.id);
  const product = await createProduct(db, seller, {
    storeId: store.id, title: `Guide ${counter}`, slug: `guide-${counter}`,
    price: money(5000n, "XOF"),
  });

  const asset = await attachAsset(db, storage, seller, {
    productId: product.id,
    title: "Le guide (PDF)",
    contentType: "application/pdf",
    bytes: PDF,
  });

  if (options.deliveryMode !== undefined) {
    await db.execute(sql`
      update products set delivery_mode = ${options.deliveryMode} where id = ${product.id}::uuid
    `);
  }
  if (options.publish !== false) await publishProduct(db, seller, product.id);

  return {
    seller,
    storeSlug: store.slug,
    productSlug: product.slug,
    productId: product.id,
    assetId: asset.id,
    priceMinor: 5000n,
  };
}

/** Buys it for real: checkout, charge, signed event. */
async function buy(buyer: Actor, listing: Listing): Promise<void> {
  counter += 1;
  const { order } = await createCheckout(db, buyer, {
    storeSlug: listing.storeSlug,
    productSlug: listing.productSlug,
    checkoutKey: `buy-${counter}`,
  });
  const payment = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });
  const event = provider.event({
    id: `evt-${counter}`,
    providerRef: payment.providerRef as string,
    status: "succeeded",
    amountMinor: listing.priceMinor,
    currency: "XOF",
  });
  await applyProviderEvent(db, provider, event.body, event.headers);
}

/** The whole buyer path in one call: grant, then spend it. */
async function read(actor: Actor, assetId: string, disposition: "inline" | "attachment" = "attachment") {
  const grant = await grantContentAccess(db, key, actor, assetId, disposition);
  return openContent(db, storage, key, actor, grant.token);
}

// ---------------------------------------------------------------------------

describe("a paid buyer can read the file", () => {
  it("serves the exact bytes the seller uploaded", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    const opened = await read(buyer, listing.assetId);
    expect(opened.object.bytes.equals(PDF)).toBe(true);
    expect(opened.object.contentType).toBe("application/pdf");
    expect(opened.title).toBe("Le guide (PDF)");
    expect(opened.disposition).toBe("attachment");
  });

  it("lists the product and its assets for the buyer, and nothing else", async () => {
    const mine = await publishedWithAsset();
    const someoneElses = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, mine);

    const library = await listEntitledProducts(db, buyer);
    expect(library.map((p) => p.productSlug)).toEqual([mine.productSlug]);
    expect(library[0]?.assetCount).toBe(1);

    expect(await findEntitledProduct(db, buyer, mine.storeSlug, mine.productSlug)).toBeDefined();
    expect(
      await findEntitledProduct(db, buyer, someoneElses.storeSlug, someoneElses.productSlug),
    ).toBeUndefined();
  });

  it("never exposes the storage key", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    const found = await findEntitledProduct(db, buyer, listing.storeSlug, listing.productSlug);
    // The asset shape has no storage key, no product id on the asset, and no
    // seller. What cannot leak is what the type does not carry.
    expect(JSON.stringify(found)).not.toContain("products/");
    expect(Object.keys(found?.assets[0] ?? {})).toEqual(
      expect.not.arrayContaining(["storageKey", "storage_key"]),
    );
  });
});

describe("access is refused to everyone else", () => {
  it("refuses a buyer who has not bought it", async () => {
    const listing = await publishedWithAsset();
    const stranger = await makeBuyer();
    await rejectsWith(read(stranger, listing.assetId), ContentForbiddenError);
  });

  it("refuses a stranger a POPULAR product's asset — the scope is per person", async () => {
    /*
     * The case that matters, and the one an easier test misses.
     *
     * If nobody has bought the product, "no entitlement exists" refuses the
     * request for the wrong reason, and a check that merely asked whether SOME
     * entitlement exists would pass the test while granting the world access to
     * anything with one buyer. So this product has three buyers, and a fourth
     * person — signed in, entitled to nothing — asks for its asset.
     */
    const listing = await publishedWithAsset();
    for (let i = 0; i < 3; i += 1) {
      const buyer = await makeBuyer();
      await buy(buyer, listing);
    }
    const stranger = await makeBuyer();

    await rejectsWith(
      grantContentAccess(db, key, stranger, listing.assetId, "attachment"),
      ContentForbiddenError,
    );
    await rejectsWith(read(stranger, listing.assetId), ContentForbiddenError);
    expect(await listEntitledProducts(db, stranger)).toEqual([]);
    expect(
      await findEntitledProduct(db, stranger, listing.storeSlug, listing.productSlug),
    ).toBeUndefined();
  });

  it("refuses buyer A using buyer B's grant", async () => {
    const listing = await publishedWithAsset();
    const owner = await makeBuyer();
    const other = await makeBuyer();
    await buy(owner, listing);
    await buy(other, listing);

    // A perfectly valid grant, issued to the owner, presented in the other
    // person's session. The subject check refuses it even though BOTH people
    // are entitled — a grant is not a bearer token.
    const grant = await grantContentAccess(db, key, owner, listing.assetId, "attachment");
    await rejectsWith(openContent(db, storage, key, other, grant.token), ContentForbiddenError);
  });

  it("refuses a stranger who obtained a buyer's grant", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    const stranger = await makeBuyer();
    await buy(buyer, listing);

    // The grant leaks — a shared screen, a copied URL, a log. Presented by
    // somebody who never bought anything, it is refused twice over: the subject
    // does not match, and there is no entitlement behind it either.
    const grant = await grantContentAccess(db, key, buyer, listing.assetId, "attachment");
    await rejectsWith(openContent(db, storage, key, stranger, grant.token), ContentForbiddenError);

    /*
     * There is no anonymous path to test here, by construction: `openContent`
     * takes an Actor, and a signed-out request never produces one. That the
     * route refuses a request with no session is asserted where it can be — in
     * the API and browser tests.
     */
  });

  it("refuses a forged grant, and one signed with the wrong key", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    await rejectsWith(openContent(db, storage, key, buyer, "not-a-grant"), ContentForbiddenError);

    const otherKey = deriveContentKey("a-different-application-secret-0000");
    const forged = await grantContentAccess(db, otherKey, buyer, listing.assetId, "attachment");
    await rejectsWith(openContent(db, storage, key, buyer, forged.token), ContentForbiddenError);
  });

  it("refuses a grant whose claims were edited", async () => {
    const listing = await publishedWithAsset();
    const owner = await makeBuyer();
    const attacker = await makeBuyer();
    await buy(owner, listing);

    const grant = await grantContentAccess(db, key, owner, listing.assetId, "attachment");
    const [payload, signature] = grant.token.split(".") as [string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u: string; e: number;
    };
    // Point it at the attacker, keep the signature. This is the whole reason
    // the payload is signed rather than merely encoded.
    claims.u = attacker.userId;
    claims.e = Date.now() + 10 * GRANT_TTL_MS;
    const edited =
      Buffer.from(JSON.stringify(claims), "utf8").toString("base64url") + "." + signature;

    await rejectsWith(openContent(db, storage, key, attacker, edited), ContentForbiddenError);
  });

  it("refuses an expired grant", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    const issued = Date.now();
    const grant = await grantContentAccess(db, key, buyer, listing.assetId, "attachment", issued);
    // One millisecond past its life.
    await rejectsWith(
      openContent(db, storage, key, buyer, grant.token, issued + GRANT_TTL_MS + 1),
      ContentForbiddenError,
    );
    // And still fine inside it.
    await expect(
      openContent(db, storage, key, buyer, grant.token, issued + GRANT_TTL_MS - 1000),
    ).resolves.toBeDefined();
  });

  it("refuses an asset id belonging to a product the buyer did not buy", async () => {
    const bought = await publishedWithAsset();
    const notBought = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, bought);

    // Substituting another product's asset id — the shape of every "change the
    // id in the request" attempt.
    await rejectsWith(read(buyer, notBought.assetId), ContentForbiddenError);
  });

  it("refuses content of a product that is no longer published", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);
    await expect(read(buyer, listing.assetId)).resolves.toBeDefined();

    // A takedown, mid-life. Access stops on the NEXT request rather than at
    // some cache expiry, because the check is a query.
    await db.execute(sql`update products set status = 'archived' where id = ${listing.productId}::uuid`);
    await rejectsWith(read(buyer, listing.assetId), ContentForbiddenError);
  });

  it("refuses content whose STORE was suspended", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    await db.execute(sql`
      update stores set status = 'suspended'
       where slug = ${listing.storeSlug}
    `);
    await rejectsWith(read(buyer, listing.assetId), ContentForbiddenError);
    expect(await listEntitledProducts(db, buyer)).toEqual([]);
  });

  it("refuses a revoked entitlement, including a grant issued before it", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    // Issued while everything was fine, spent after the revocation. The second
    // check is what catches this — the grant itself is still perfectly valid.
    const grant = await grantContentAccess(db, key, buyer, listing.assetId, "attachment");
    expect(await revokeEntitlement(db, buyer.userId, listing.productId, "test")).toBe(true);

    await rejectsWith(openContent(db, storage, key, buyer, grant.token), ContentForbiddenError);
    await rejectsWith(grantContentAccess(db, key, buyer, listing.assetId, "attachment"), ContentForbiddenError);
    expect(await listEntitledProducts(db, buyer)).toEqual([]);

    // Revoking twice changes nothing, and the record of the grant survives.
    expect(await revokeEntitlement(db, buyer.userId, listing.productId, "again")).toBe(false);
    const rows = await db.execute<{ n: string }>(sql`
      select count(*) as n from entitlements where user_id = ${buyer.userId}::uuid
    `);
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it("refuses a reader with no order.read_own permission", async () => {
    const listing = await publishedWithAsset();
    const userId = await createTestUser(db, { locale: "fr" });
    await rejectsWith(
      grantContentAccess(db, key, { userId }, listing.assetId, "attachment"),
      PermissionDeniedError,
    );
  });
});

describe("the seller's side", () => {
  it("refuses a seller attaching to another seller's product", async () => {
    const mine = await publishedWithAsset();
    const other = await makeSeller();

    await rejectsWith(
      attachAsset(db, storage, other, {
        productId: mine.productId, title: "Mine now", contentType: "application/pdf", bytes: PDF,
      }),
      PermissionDeniedError,
    );
    await rejectsWith(listProductAssets(db, other, mine.productId), PermissionDeniedError);
  });

  it("lets a seller read back their own product's assets", async () => {
    const listing = await publishedWithAsset();
    const assets = await listProductAssets(db, listing.seller, listing.productId);
    expect(assets.map((a) => a.id)).toEqual([listing.assetId]);
  });

  it("does not let a seller read another seller's FILE through the buyer path", async () => {
    const mine = await publishedWithAsset();
    const other = await makeSeller();
    // Owning a store is not owning the platform. Without an entitlement, the
    // buyer path refuses a seller exactly as it refuses anyone else.
    await rejectsWith(read(other, mine.assetId), ContentForbiddenError);
  });

  it("does not let a seller read their OWN file through the buyer path either", async () => {
    // Not a restriction anyone will feel — sellers reach their files through
    // the seller path — but it is the honest consequence of deriving access
    // from entitlements rather than from "somehow related to this row".
    const listing = await publishedWithAsset();
    await rejectsWith(read(listing.seller, listing.assetId), ContentForbiddenError);
  });

  it("refuses a content type that is not on the list", async () => {
    const listing = await publishedWithAsset();
    await rejectsWith(
      attachAsset(db, storage, listing.seller, {
        productId: listing.productId, title: "xss.html",
        contentType: "text/html", bytes: Buffer.from("<script>alert(1)</script>", "utf8"),
      }),
      UnsupportedContentTypeError,
    );
    // The allow-list is the reason: these bytes would be served back from an
    // Afrinext origin, so an uploaded document is same-origin script.
    expect(ACCEPTED_CONTENT_TYPES).not.toContain("text/html");
  });

  it("refuses an empty file and one over the size limit", async () => {
    const listing = await publishedWithAsset();
    await rejectsWith(
      attachAsset(db, storage, listing.seller, {
        productId: listing.productId, title: "empty",
        contentType: "application/pdf", bytes: Buffer.alloc(0),
      }),
      AssetTooLargeError,
    );
    await rejectsWith(
      attachAsset(db, storage, listing.seller, {
        productId: listing.productId, title: "huge",
        contentType: "application/pdf", bytes: Buffer.alloc(MAX_ASSET_BYTES + 1),
      }),
      AssetTooLargeError,
    );
  });

  it("answers identically for a product that does not exist", async () => {
    const seller = await makeSeller();
    await rejectsWith(
      attachAsset(db, storage, seller, {
        productId: "00000000-0000-0000-0000-000000000000",
        title: "nowhere", contentType: "application/pdf", bytes: PDF,
      }),
      ContentForbiddenError,
    );
  });

  it("records the checksum of what it stored", async () => {
    const listing = await publishedWithAsset();
    const rows = await db.execute<{ checksum_sha256: string; byte_size: string }>(sql`
      select checksum_sha256, byte_size from digital_assets where id = ${listing.assetId}::uuid
    `);
    expect(rows.rows[0]?.checksum_sha256).toHaveLength(64);
    expect(Number(rows.rows[0]?.byte_size)).toBe(PDF.byteLength);
  });
});

describe("the download policy is a server decision", () => {
  it("serves a view_only product inline and refuses an attachment grant", async () => {
    const listing = await publishedWithAsset({ deliveryMode: "view_only" });
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    await rejectsWith(
      grantContentAccess(db, key, buyer, listing.assetId, "attachment"),
      ContentForbiddenError,
    );

    const opened = await read(buyer, listing.assetId, "inline");
    expect(opened.disposition).toBe("inline");
    /*
     * And that is all it is. The bytes are served, so anyone who can read them
     * can save them. `view_only` is a policy about what Afrinext offers, not a
     * technical protection, and nothing in this codebase calls it DRM.
     */
    expect(opened.object.bytes.equals(PDF)).toBe(true);
  });

  it("lets a downloadable product be read inline too", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);
    expect((await read(buyer, listing.assetId, "inline")).disposition).toBe("inline");
  });
});

describe("entitlement creation is still payment's job", () => {
  it("grants nothing for a checkout that was only opened", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "opened",
    });

    expect(await listEntitledProducts(db, buyer)).toEqual([]);
    await rejectsWith(read(buyer, listing.assetId), ContentForbiddenError);
  });

  it("grants nothing while a payment is merely pending", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "pending",
    });
    await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });

    expect(await listEntitledProducts(db, buyer)).toEqual([]);
    await rejectsWith(read(buyer, listing.assetId), ContentForbiddenError);
  });

  it("grants nothing when a late payment is queued for refund", async () => {
    /*
     * The case the previous milestone flagged, now decided and re-asserted from
     * the delivery side.
     *
     * The payment succeeds after the grace window, so the order becomes
     * `refund_due` — Afrinext owes the buyer their money and did not deliver.
     * What matters here is the delivery half: a refund-due order grants no
     * entitlement, so no content is reachable through it. Access still comes
     * from an entitlement and from nothing else.
     */
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "expiring",
    });
    const payment = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });

    // Aged past the checkout window, then swept, exactly as time would do it.
    await db.execute(sql`
      update orders set expires_at = now() - interval '1 second' where id = ${order.id}::uuid
    `);
    await expireLapsedOrders(db);

    const expiry = await db.execute<{ expires_at: Date | string }>(sql`
      select expires_at from orders where id = ${order.id}::uuid`);
    const boundary = new Date(expiry.rows[0]!.expires_at).getTime();

    const event = provider.event({
      id: "evt-expired", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: listing.priceMinor, currency: "XOF",
    });
    // A day and a millisecond after expiry: past the grace window.
    await applyProviderEvent(
      db, provider, event.body, event.headers,
      boundary + DEFAULT_LATE_PAYMENT_GRACE_SECONDS * 1000 + 1,
    );

    const status = await db.execute<{ status: string }>(sql`
      select status from orders where id = ${order.id}::uuid`);
    expect(status.rows[0]?.status).toBe("refund_due");

    expect(await listEntitledProducts(db, buyer)).toEqual([]);
    await rejectsWith(read(buyer, listing.assetId), ContentForbiddenError);
  });

  it("DOES grant when a late payment is accepted inside the grace window", async () => {
    // The other half of the same decision: a payment a minute late is a
    // payment, and the buyer gets what they bought.
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "just-late",
    });
    const payment = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });

    await db.execute(sql`
      update orders set expires_at = now() - interval '1 second' where id = ${order.id}::uuid
    `);
    await expireLapsedOrders(db);

    const event = provider.event({
      id: "evt-just-late", providerRef: payment.providerRef as string, status: "succeeded",
      amountMinor: listing.priceMinor, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    expect((await listEntitledProducts(db, buyer)).length).toBe(1);
    expect((await read(buyer, listing.assetId)).object.bytes.equals(PDF)).toBe(true);
  });

  it("creates exactly one entitlement under concurrent confirmations", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: listing.storeSlug, productSlug: listing.productSlug, checkoutKey: "concurrent",
    });
    const payment = await initiatePayment(db, buyer, provider, { orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL });
    const event = provider.event({
      id: "evt-concurrent-delivery", providerRef: payment.providerRef as string,
      status: "succeeded", amountMinor: listing.priceMinor, currency: "XOF",
    });

    await Promise.allSettled(
      Array.from({ length: 5 }, () => applyProviderEvent(db, provider, event.body, event.headers)),
    );

    const rows = await db.execute<{ n: string }>(sql`
      select count(*) as n from entitlements where user_id = ${buyer.userId}::uuid
    `);
    expect(Number(rows.rows[0]?.n)).toBe(1);
    expect((await listEntitledProducts(db, buyer)).length).toBe(1);
  });

  it("serves the file correctly under concurrent reads", async () => {
    const listing = await publishedWithAsset();
    const buyer = await makeBuyer();
    await buy(buyer, listing);

    const reads = await Promise.all(
      Array.from({ length: 8 }, () => read(buyer, listing.assetId)),
    );
    expect(reads.every((r) => r.object.bytes.equals(PDF))).toBe(true);
  });
});

describe("storage keys are checked, not trusted", () => {
  it("refuses a traversal, an absolute path and an empty key", () => {
    for (const bad of ["../secrets", "products/../../etc/passwd", "/etc/passwd", "", "a b"]) {
      expect(() => assertUsableStorageKey(bad), bad).toThrow(InvalidStorageKeyError);
    }
    expect(() => assertUsableStorageKey("products/abc/def")).not.toThrow();
  });

  it("keeps a filesystem store inside its root", async () => {
    const root = `/tmp/afrinext-content-test-${Date.now()}`;
    const fs = new FilesystemContentStorage(root);
    await fs.put("products/x/y", PDF, "application/pdf");
    expect((await fs.open("products/x/y")).bytes.equals(PDF)).toBe(true);
    await expect(fs.open("../../etc/passwd")).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await fs.remove("products/x/y");
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
