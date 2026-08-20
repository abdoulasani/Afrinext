import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import { PermissionDeniedError } from "../errors";
import { money } from "../money";
import { createTestUser, ensureReferenceData, expectRejection, resetData, testDb } from "../test/harness";
import type { Actor } from "../authz";
import {
  assertUsableSlug, createProduct, createStore, findPublicProduct, InvalidSlugError,
  listPublicProducts, listOwnStores, listStoreProducts, NotPublishableError, publishProduct,
  publishStore, RESERVED_SLUGS, slugify, SlugTakenError, UnsupportedCurrencyError, updateStore,
} from "./index";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

/** Grants a global role by key. Mirrors what an admin console would do. */
async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

async function makeSeller(): Promise<Actor> {
  const userId = await createTestUser(db);
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "seller");
  return { userId };
}

/** A seller with a published store, which is the precondition for publishing. */
async function sellerWithLiveStore(slug: string): Promise<{ actor: Actor; storeId: string }> {
  const actor = await makeSeller();
  const store = await createStore(db, actor, { name: "Boutique", slug });
  await publishStore(db, actor, store.id);
  return { actor, storeId: store.id };
}

const XOF = (whole: number) => money(BigInt(whole), "XOF");

describe("slugs are public identity", () => {
  it("derives a readable slug from an accented name", () => {
    // Niamey writes accented French. The URL should stay legible, not become
    // percent-encoded mush.
    expect(slugify("Café Niamey")).toBe("cafe-niamey");
    expect(slugify("  Éditions   du   Sahel!  ")).toBe("editions-du-sahel");
  });

  it("refuses shapes that would break or impersonate a path", () => {
    for (const bad of ["ab", "Has Capitals", "trailing-", "--double", "with_underscore", "sp ace"]) {
      expect(() => assertUsableSlug(slugify(bad) === bad ? bad : bad, "store"), bad).toThrow(InvalidSlugError);
    }
  });

  it("reserves the paths Afrinext owns", () => {
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
    expect(() => assertUsableSlug("admin", "store")).toThrow(InvalidSlugError);
    expect(() => assertUsableSlug("api", "store")).toThrow(InvalidSlugError);
    // Products live below a store slug, so they cannot collide with our routes.
    expect(() => assertUsableSlug("admin", "product")).not.toThrow();
  });
});

describe("opening a store is a granted capability", () => {
  it("refuses a signed-in member who is not a seller", async () => {
    const userId = await createTestUser(db);
    await grantGlobal(userId, "member");

    // `store.create` exists as a permission but `member` does not hold it.
    // Whether signing up should make someone a seller is a policy decision,
    // and until it is taken the answer is no.
    await expect(createStore(db, { userId }, { name: "Chez Moi" }))
      .rejects.toBeInstanceOf(PermissionDeniedError);

    expect((await db.execute(sql`select 1 from stores`)).rows).toHaveLength(0);
  });

  it("lets a seller open one, and makes them its owner in the same breath", async () => {
    const actor = await makeSeller();
    const store = await createStore(db, actor, { name: "Éditions du Sahel", tagline: "Livres" });

    expect(store.slug).toBe("editions-du-sahel");
    expect(store.status).toBe("draft");
    expect(store.ownerUserId).toBe(actor.userId);

    // Ownership is a scoped role assignment, not an inference from the owner
    // column at request time. Without it the creator could not administer the
    // store they just made.
    const roles = await db.execute<{ key: string; scope_id: string }>(sql`
      select r.key, ra.scope_id from role_assignments ra
        join roles r on r.id = ra.role_id
       where ra.user_id = ${actor.userId}::uuid and ra.scope_type = 'store'
    `);
    expect(roles.rows).toHaveLength(1);
    expect(roles.rows[0]?.key).toBe("store_owner");
    expect(roles.rows[0]?.scope_id).toBe(store.id);
  });

  it("refuses a slug someone already holds", async () => {
    const a = await makeSeller();
    const b = await makeSeller();
    await createStore(db, a, { name: "Sahel", slug: "sahel" });
    await expect(createStore(db, b, { name: "Sahel Two", slug: "sahel" }))
      .rejects.toBeInstanceOf(SlugTakenError);
  });

  it("audits the creation", async () => {
    const actor = await makeSeller();
    await createStore(db, actor, { name: "Sahel" });
    const rows = await db.execute<{ action: string }>(
      sql`select action from audit_logs where action = 'store.created'`,
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("a store is a scope, not a suggestion", () => {
  it("stops a store owner from touching a store that is not theirs", async () => {
    const mine = await makeSeller();
    const theirs = await makeSeller();
    const myStore = await createStore(db, mine, { name: "Mine", slug: "mine-store" });
    const theirStore = await createStore(db, theirs, { name: "Theirs", slug: "theirs-store" });

    // Being a store_owner somewhere is not being a store_owner everywhere. This
    // is the whole reason roles carry a scope.
    await expect(updateStore(db, mine, theirStore.id, { name: "Hijacked" }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      createProduct(db, mine, { storeId: theirStore.id, title: "Sneaky", price: XOF(1000) }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // And the owner can still work on their own.
    await expect(updateStore(db, mine, myStore.id, { name: "Renamed" })).resolves.toBeDefined();
  });

  it("lists only the actor's own stores", async () => {
    const mine = await makeSeller();
    const theirs = await makeSeller();
    await createStore(db, mine, { name: "Mine", slug: "mine-list" });
    await createStore(db, theirs, { name: "Theirs", slug: "theirs-list" });

    const listed = await listOwnStores(db, mine);
    expect(listed.map((s) => s.slug)).toEqual(["mine-list"]);
  });
});

describe("prices stay in the money model", () => {
  it("stores minor units as a bigint and reads them back unchanged", async () => {
    const { actor, storeId } = await sellerWithLiveStore("price-store");
    const product = await createProduct(db, actor, {
      storeId, title: "Guide complet", price: XOF(15000),
    });

    expect(product.price.amountMinor).toBe(15000n);
    expect(product.price.currency).toBe("XOF");

    const raw = await db.execute<{ price_minor: string; currency: string }>(
      sql`select price_minor, currency from products where id = ${product.id}`,
    );
    // XOF has zero decimals: 15 000 francs is 15000 minor units, not 1 500 000.
    expect(BigInt(raw.rows[0]!.price_minor)).toBe(15000n);
    expect(raw.rows[0]?.currency).toBe("XOF");
  });

  it("survives an amount no double could hold exactly", async () => {
    const { actor, storeId } = await sellerWithLiveStore("big-price-store");
    const huge = 9_007_199_254_740_993n; // Number.MAX_SAFE_INTEGER + 2
    const product = await createProduct(db, actor, {
      storeId, title: "Absurdly expensive", price: money(huge, "XOF"),
    });
    // Round-tripping through a float would land on ...992. This is the point of
    // bigint minor units, and the assertion that would catch a regression to
    // number arithmetic anywhere in this path.
    expect(product.price.amountMinor).toBe(huge);
  });

  it("refuses a free or negative price", async () => {
    const { actor, storeId } = await sellerWithLiveStore("free-store");
    await expect(createProduct(db, actor, { storeId, title: "Free", price: XOF(0) }))
      .rejects.toBeInstanceOf(NotPublishableError);
    await expect(createProduct(db, actor, { storeId, title: "Owed", price: money(-1n, "XOF") }))
      .rejects.toBeInstanceOf(NotPublishableError);
  });

  it("refuses a currency that is not active in the currencies table", async () => {
    const { actor, storeId } = await sellerWithLiveStore("currency-store");
    // NGN is seeded but inactive. Currencies are rows; code does not get a vote.
    await expect(createProduct(db, actor, { storeId, title: "Naira", price: money(500n, "NGN") }))
      .rejects.toBeInstanceOf(UnsupportedCurrencyError);
  });

  it("is refused by the database too, not only by this code", async () => {
    const { storeId } = await sellerWithLiveStore("db-guard-store");
    // The service checks the price, but so does PostgreSQL — a future caller
    // that bypasses createProduct still cannot write a free product.
    await expectRejection(
      db.execute(sql`
        insert into products (id, store_id, slug, title, price_minor, currency)
        values (gen_random_uuid(), ${storeId}::uuid, 'freebie', 'Free', 0, 'XOF')
      `),
      /products_price_positive/,
    );
  });
});

describe("publishing", () => {
  it("refuses to publish a product whose store is still a draft", async () => {
    const actor = await makeSeller();
    const store = await createStore(db, actor, { name: "Quiet", slug: "quiet-store" });
    const product = await createProduct(db, actor, {
      storeId: store.id, title: "Early", price: XOF(2000),
    });

    // Otherwise the product gets a live URL the seller never meant to expose.
    await expect(publishProduct(db, actor, product.id)).rejects.toBeInstanceOf(NotPublishableError);
    expect(await findPublicProduct(db, "quiet-store", "early")).toBeUndefined();
  });

  it("sets published_at, which the database insists on", async () => {
    const { actor, storeId } = await sellerWithLiveStore("timestamp-store");
    const product = await createProduct(db, actor, {
      storeId, title: "Timed", price: XOF(3000),
    });
    const published = await publishProduct(db, actor, product.id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeInstanceOf(Date);

    await expectRejection(
      db.execute(sql`update products set published_at = null where id = ${product.id}`),
      /products_published_has_timestamp/,
    );
  });

  it("audits the publication", async () => {
    const { actor, storeId } = await sellerWithLiveStore("audit-store");
    const product = await createProduct(db, actor, { storeId, title: "Audited", price: XOF(1000) });
    await publishProduct(db, actor, product.id);

    const actions = (await db.execute<{ action: string }>(
      sql`select action from audit_logs order by occurred_at`,
    )).rows.map((r) => r.action);
    expect(actions).toContain("store.created");
    expect(actions).toContain("store.published");
    expect(actions).toContain("product.created");
    expect(actions).toContain("product.published");
  });
});

describe("the public view shows only what it should", () => {
  it("serves a published product under a published store", async () => {
    const { actor, storeId } = await sellerWithLiveStore("open-store");
    const product = await createProduct(db, actor, {
      storeId, title: "Guide Niamey", summary: "Un guide", price: XOF(7500),
    });
    await publishProduct(db, actor, product.id);

    const seen = await findPublicProduct(db, "open-store", "guide-niamey");
    expect(seen?.title).toBe("Guide Niamey");
    expect(seen?.price.amountMinor).toBe(7500n);
    expect(seen?.price.currency).toBe("XOF");
  });

  it("hides a draft product", async () => {
    const { actor, storeId } = await sellerWithLiveStore("draft-store");
    await createProduct(db, actor, { storeId, title: "Unfinished", price: XOF(1000) });
    expect(await findPublicProduct(db, "draft-store", "unfinished")).toBeUndefined();
    expect(await listPublicProducts(db, "draft-store")).toHaveLength(0);
  });

  it("hides everything under a store that is not published", async () => {
    const { actor, storeId } = await sellerWithLiveStore("later-hidden");
    const product = await createProduct(db, actor, { storeId, title: "Visible", price: XOF(1000) });
    await publishProduct(db, actor, product.id);
    expect(await findPublicProduct(db, "later-hidden", "visible")).toBeDefined();

    // Suspending the store takes its whole catalogue down with it, without
    // touching a single product row.
    await db.execute(sql`update stores set status = 'suspended' where id = ${storeId}`);
    expect(await findPublicProduct(db, "later-hidden", "visible")).toBeUndefined();
    expect(await listPublicProducts(db, "later-hidden")).toHaveLength(0);
  });

  it("carries no private field at all", async () => {
    const { actor, storeId } = await sellerWithLiveStore("privacy-store");
    const product = await createProduct(db, actor, {
      storeId, title: "Public Thing", price: XOF(4000),
    });
    await publishProduct(db, actor, product.id);

    const seen = await findPublicProduct(db, "privacy-store", "public-thing");
    expect(seen).toBeDefined();

    // The public shape is a different type, not a filtered copy — so this
    // asserts the absence of fields that were never selected in the first place.
    const keys = Object.keys(seen!);
    for (const leaked of ["ownerUserId", "storeId", "id", "status", "publishedAt", "createdAt"]) {
      expect(keys, `public product must not carry ${leaked}`).not.toContain(leaked);
    }
    // And nothing that identifies the seller is anywhere in the payload.
    // The replacer is needed because the price is a bigint — which is itself
    // worth knowing: any transport returning this must serialise money
    // deliberately rather than handing the object to JSON.stringify.
    const dumped = JSON.stringify(seen, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(dumped).not.toContain(actor.userId);
    expect(dumped).not.toContain(storeId);
  });

  it("does not confuse two stores that use the same product slug", async () => {
    const a = await sellerWithLiveStore("store-alpha");
    const b = await sellerWithLiveStore("store-beta");
    const pa = await createProduct(db, a.actor, { storeId: a.storeId, title: "Ebook", price: XOF(1000) });
    const pb = await createProduct(db, b.actor, { storeId: b.storeId, title: "Ebook", price: XOF(2000) });
    await publishProduct(db, a.actor, pa.id);
    await publishProduct(db, b.actor, pb.id);

    // Product slugs are unique per store, so the store slug is what
    // disambiguates them. Getting this wrong would show one seller's price on
    // another seller's page.
    expect((await findPublicProduct(db, "store-alpha", "ebook"))?.price.amountMinor).toBe(1000n);
    expect((await findPublicProduct(db, "store-beta", "ebook"))?.price.amountMinor).toBe(2000n);
  });
});

describe("administering a catalogue needs the store scope", () => {
  it("refuses to list a store's drafts to someone outside it", async () => {
    const mine = await sellerWithLiveStore("list-mine");
    const other = await makeSeller();
    await createProduct(db, mine.actor, { storeId: mine.storeId, title: "Secret Draft", price: XOF(1000) });

    expect(await listStoreProducts(db, mine.actor, mine.storeId)).toHaveLength(1);
    await expect(listStoreProducts(db, other, mine.storeId))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
