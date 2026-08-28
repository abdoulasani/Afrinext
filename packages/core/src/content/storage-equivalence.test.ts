import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishProduct, publishStore } from "../catalog";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { money } from "../money";
import { applyProviderEvent, createCheckout, initiatePayment } from "../orders";
import { LAUNCH_PAYMENT_CHANNEL, MockPaymentProvider } from "../payments";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { startS3TestServer, type S3TestServer } from "../test/s3-server";
import {
  attachAsset, ContentForbiddenError, deriveContentKey, DownloadLimitReachedError,
  findEntitledProduct, grantContentAccess, InMemoryContentStorage, openContent,
  revokeEntitlementsForOrder, setDownloadLimit, setDraftLicence,
  type ContentStorage,
} from "./index";
import { S3ContentStorage } from "./s3";

/**
 * The adapter is interchangeable, and this is what that claim means.
 *
 * The milestone's whole promise is that moving from a directory to a bucket
 * changes WHERE bytes live and nothing else. A promise like that is easy to
 * make and easy to break quietly — an adapter that returned a slightly
 * different content type, or that failed in a way the download counter treated
 * as success, would leave every existing test green while changing what a
 * buyer actually gets.
 *
 * So the same journey runs TWICE, once per adapter, through the same domain
 * functions, and the two runs are asserted to agree on every semantic the
 * engine sells: the bytes, the content type, the version pin, the licence
 * snapshot, the download count, the limit, refusals to strangers, and
 * revocation after a refund.
 *
 * The second adapter talks real HTTP to a server that verifies its signatures,
 * so "the S3 run" is not a stub agreeing with itself.
 */

const SECRET = "test-application-secret-0123456789abcdef";
const V1 = Buffer.from("%PDF-1.7\nversion one\n%%EOF\n", "utf8");
const V2 = Buffer.from("%PDF-1.7\nversion two\n%%EOF\n", "utf8");

let db: Database;
let provider: MockPaymentProvider;
let key: Buffer;
let s3: S3TestServer;
let counter = 0;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
  s3 = await startS3TestServer();
});

afterAll(async () => { await s3.close(); });

beforeEach(async () => {
  await resetData(db);
  provider = new MockPaymentProvider();
  key = deriveContentKey(SECRET);
  await db.execute(sql`
    insert into commission_rules
      (id, transaction_type, rate_bps, currency, priority, effective_from)
    values (gen_random_uuid(), 'digital', 1800, 'XOF', 0, '2026-01-01T00:00:00Z')
  `);
});

function s3Storage(): S3ContentStorage {
  return new S3ContentStorage({
    endpoint: s3.endpoint, region: "us-east-1", bucket: s3.bucket,
    accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey,
    forcePathStyle: true,
  });
}

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

/**
 * Everything the engine promises, observed once, through one adapter.
 *
 * Returns a plain record so the two runs can be compared field by field rather
 * than by two parallel sets of assertions that could drift apart.
 */
async function observe(storage: ContentStorage): Promise<Record<string, unknown>> {
  counter += 1;
  const seller = await makeSeller();
  const store = await createStore(db, seller, {
    storeType: "digital_product", name: `Boutique ${counter}`, slug: `eq-boutique-${counter}`,
  });
  await publishStore(db, seller, store.id);
  const product = await createProduct(db, seller, {
    storeId: store.id, title: `Guide ${counter}`, slug: `eq-guide-${counter}`,
    price: money(5000n, "XOF"),
  });
  const asset = await attachAsset(db, storage, seller, {
    productId: product.id, title: "Le guide (PDF)", contentType: "application/pdf", bytes: V1,
  });
  await setDraftLicence(db, seller, product.id, "Usage personnel.");
  await setDownloadLimit(db, seller, product.id, 2);
  await publishProduct(db, seller, product.id);

  const buyer = await makeBuyer();
  const { order } = await createCheckout(db, buyer, {
    storeSlug: store.slug, productSlug: product.slug, checkoutKey: `eq-${counter}`,
  });
  const payment = await initiatePayment(db, buyer, provider, {
    orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL,
  });
  const event = provider.event({
    id: `eq-evt-${counter}`, providerRef: payment.providerRef as string,
    status: "succeeded", amountMinor: 5000n, currency: "XOF",
  });
  await applyProviderEvent(db, provider, event.body, event.headers);

  const download = async (actor: Actor, assetId: string) => {
    const grant = await grantContentAccess(db, key, actor, assetId, "attachment");
    return openContent(db, storage, key, actor, grant.token);
  };

  const first = await download(buyer, asset.id);
  const owned = await findEntitledProduct(db, buyer, store.slug, product.slug);

  // A stranger, and another buyer of nothing.
  const stranger = await makeBuyer();
  const strangerRefused = await download(stranger, asset.id)
    .then(() => "allowed", (e: unknown) => (e as Error).name);

  // The seller publishes a second version; the buyer stays pinned.
  const v2 = await attachAsset(db, storage, seller, {
    productId: product.id, title: "Le guide (corrigé)",
    contentType: "application/pdf", bytes: V2,
  });
  const { publishVersion } = await import("./versions");
  await publishVersion(db, seller, product.id);
  const afterNewVersion = await download(buyer, asset.id);
  const v2Refused = await download(buyer, v2.id)
    .then(() => "allowed", (e: unknown) => (e as Error).name);

  // The limit, reached.
  const second = await download(buyer, asset.id).then(() => "ok", (e: unknown) => (e as Error).name);
  const third = await download(buyer, asset.id).then(() => "ok", (e: unknown) => (e as Error).name);

  // Refunded.
  await revokeEntitlementsForOrder(db, order.id, "refund.succeeded");
  const afterRefund = await download(buyer, asset.id)
    .then(() => "allowed", (e: unknown) => (e as Error).name);

  const counted = await db.execute<{ [k: string]: unknown; n: string }>(sql`
    select count(*)::text as n from entitlement_downloads
     where asset_id = ${asset.id}::uuid
  `);

  return {
    bytes: first.object.bytes.toString("utf8"),
    contentType: first.object.contentType,
    title: first.title,
    disposition: first.disposition,
    versionNo: owned?.versionNo,
    latestVersionNoBeforePublish: owned?.latestVersionNo,
    licenceSnapshot: owned?.licenceSnapshot,
    downloadLimit: owned?.downloadLimit,
    strangerRefused,
    pinnedBytesAfterNewVersion: afterNewVersion.object.bytes.toString("utf8"),
    v2Refused,
    secondDownload: second,
    thirdDownload: third,
    afterRefund,
    downloadsRecorded: counted.rows[0]?.n,
  };
}

// ===========================================================================

describe("the storage adapter is interchangeable", () => {
  it("gives byte-for-byte identical behaviour on both adapters", async () => {
    const memory = await observe(new InMemoryContentStorage());
    const objectStore = await observe(s3Storage());

    // Field by field, so a failure names what differs rather than dumping two
    // large objects side by side.
    for (const field of Object.keys(memory)) {
      expect(objectStore[field], `"${field}" must not depend on where bytes live`)
        .toEqual(memory[field]);
    }

    // And the values are the RIGHT ones, not merely equal to each other: two
    // adapters that were both broken the same way would pass the loop above.
    expect(memory["bytes"]).toBe(V1.toString("utf8"));
    expect(memory["contentType"]).toBe("application/pdf");
    expect(memory["versionNo"]).toBe(1);
    expect(memory["licenceSnapshot"]).toBe("Usage personnel.");
    expect(memory["downloadLimit"]).toBe(2);
    expect(memory["strangerRefused"]).toBe(ContentForbiddenError.name);
    expect(memory["pinnedBytesAfterNewVersion"]).toBe(V1.toString("utf8"));
    expect(memory["v2Refused"]).toBe(ContentForbiddenError.name);
    expect(memory["thirdDownload"]).toBe(DownloadLimitReachedError.name);
    expect(memory["afterRefund"]).toBe(ContentForbiddenError.name);
    expect(memory["downloadsRecorded"]).toBe("2");
  });

  it("does not spend a download when the object store fails", async () => {
    const storage = s3Storage();
    counter += 1;
    const seller = await makeSeller();
    const store = await createStore(db, seller, {
      storeType: "digital_product", name: `B ${counter}`, slug: `eqf-${counter}`,
    });
    await publishStore(db, seller, store.id);
    const product = await createProduct(db, seller, {
      storeId: store.id, title: `G ${counter}`, slug: `eqf-g-${counter}`,
      price: money(5000n, "XOF"),
    });
    const asset = await attachAsset(db, storage, seller, {
      productId: product.id, title: "Le guide", contentType: "application/pdf", bytes: V1,
    });
    await setDownloadLimit(db, seller, product.id, 2);
    await publishProduct(db, seller, product.id);

    const buyer = await makeBuyer();
    const { order } = await createCheckout(db, buyer, {
      storeSlug: store.slug, productSlug: product.slug, checkoutKey: `eqf-${counter}`,
    });
    const payment = await initiatePayment(db, buyer, provider, {
      orderId: order.id, channel: LAUNCH_PAYMENT_CHANNEL,
    });
    const event = provider.event({
      id: `eqf-evt-${counter}`, providerRef: payment.providerRef as string,
      status: "succeeded", amountMinor: 5000n, currency: "XOF",
    });
    await applyProviderEvent(db, provider, event.body, event.headers);

    const grant = await grantContentAccess(db, key, buyer, asset.id, "attachment");
    s3.failNext(503);
    await expect(
      openContent(db, storage, key, buyer, grant.token),
      "a provider outage is not a delivery",
    ).rejects.toThrow();

    const counted = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(*)::text as n from entitlement_downloads where asset_id = ${asset.id}::uuid
    `);
    expect(counted.rows[0]?.n, "nothing was counted").toBe("0");

    // And the buyer still has both downloads afterwards.
    const retry = await grantContentAccess(db, key, buyer, asset.id, "attachment");
    const served = await openContent(db, storage, key, buyer, retry.token);
    expect(served.object.bytes.toString("utf8")).toBe(V1.toString("utf8"));
  });
});
