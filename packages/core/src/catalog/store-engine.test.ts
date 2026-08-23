import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { PermissionDeniedError } from "../errors";
import { money } from "../money";
import { createTestUser, ensureReferenceData, giveProductAFile, resetData, testDb } from "../test/harness";
import {
  countDiscoverableStores, countStoresByType, createProduct, createStore, defaultBrandFor,
  discoverOfferings, discoverStores, findPublicStore, isStoreType, listPublicProducts,
  NotPublishableError,
  parseStoreBrand, parseStoreType, publishProduct, publishStore, reinstateStore,
  STORE_BRANDS, STORE_TYPES, suspendStore, unpublishStore, UnsupportedStoreBrandError,
  UnsupportedStoreTypeError, updateStore,
} from "./index";

/**
 * The universal store engine.
 *
 * One Store entity, six businesses. These tests care about the two things that
 * make that safe: a store's TYPE is validated rather than assumed, and a
 * store's VISIBILITY is decided in SQL rather than by a caller remembering to
 * filter. The second is the one that would leak somebody's unpublished shop.
 */

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

/**
 * `insert ... select` grants nothing at all when the role key does not exist,
 * and says so silently. A misspelled role would then produce an actor with no
 * permissions, and every test asserting a refusal would still pass — for
 * entirely the wrong reason. So the row count is checked.
 */
async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  const result = await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
  if (result.rowCount !== 1) {
    throw new Error(`No role named "${roleKey}" — the grant did nothing.`);
  }
}

async function makeSeller(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "seller");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, { method: "signup" });
  await acceptCurrentVersions(db, userId, ["seller_terms"], { locale: "fr" }, { method: "seller_onboarding" });
  return { userId };
}

/** `ops` is the catalogue moderator: it holds `store.moderate` and no money. */
async function makeModerator(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "ops");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, { method: "signup" });
  return { userId };
}

let counter = 0;
async function publishedStore(
  actor: Actor,
  overrides: Partial<Parameters<typeof createStore>[2]> = {},
) {
  counter += 1;
  const store = await createStore(db, actor, {
    name: `Boutique ${counter}`,
    slug: `boutique-${counter}`,
    storeType: "digital_product",
    ...overrides,
  });
  await publishStore(db, actor, store.id);
  return store;
}

// ---------------------------------------------------------------------------

describe("store types", () => {
  it("offers exactly the six the product decided on", () => {
    expect(STORE_TYPES).toEqual([
      "formation", "digital_product", "physical_product", "service", "creator", "delivery",
    ]);
  });

  it("stores each type faithfully, without translating it", async () => {
    const seller = await makeSeller();
    for (const storeType of STORE_TYPES) {
      const store = await createStore(db, seller, {
        name: `Shop ${storeType}`, slug: `shop-${storeType.replace(/_/g, "-")}`, storeType,
      });
      expect(store.storeType).toBe(storeType);
    }
  });

  it("refuses a type nobody decided to support", async () => {
    const seller = await makeSeller();
    for (const bogus of ["auction", "FORMATION", "", "service ", null, 7, {}]) {
      await expect(createStore(db, seller, {
          name: "Nope", slug: `nope-${String(bogus).slice(0, 4).replace(/\W/g, "x")}`,
          storeType: bogus as never,
        })).rejects.toBeInstanceOf(UnsupportedStoreTypeError);
    }
    const rows = await db.execute<{ [k: string]: unknown; n: string }>(
      sql`select count(*) as n from stores`,
    );
    expect(Number(rows.rows[0]?.n), "nothing was written for any of them").toBe(0);
  });

  it("parses only exact values", () => {
    expect(parseStoreType("service")).toBe("service");
    expect(isStoreType("service")).toBe(true);
    expect(isStoreType("Service")).toBe(false);
    expect(() => parseStoreType(undefined)).toThrow(UnsupportedStoreTypeError);
  });

  /*
   * Ordering, and it is a security property rather than a nicety.
   *
   * `CreateStoreInput.storeType` used to be typed as `StoreType`, which forced
   * every HTTP boundary to call `parseStoreType` to satisfy the compiler — and
   * so an unauthorized request was answered "unsupported store type" (400)
   * instead of "denied" (403). That tells a stranger their request SHAPE was
   * wrong, which is a fact about the API they had not earned. Both gates must
   * answer before any field is judged.
   */
  it("refuses on permission before it looks at the type at all", async () => {
    const stranger = await createTestUser(db, { locale: "fr" });
    await acceptCurrentVersions(
      db, stranger, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, { method: "signup" },
    );
    // No `seller` role, and a store type that is nonsense. The permission is
    // what must answer.
    await expect(createStore(db, { userId: stranger }, {
      name: "Interdite", slug: "interdite", storeType: "not_a_type",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses on consent before it looks at the type", async () => {
    // Holds `seller`, has NOT accepted the seller terms. Same bogus type.
    const userId = await createTestUser(db, { locale: "fr" });
    await grantGlobal(userId, "member");
    await grantGlobal(userId, "seller");
    await acceptCurrentVersions(
      db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, { method: "signup" },
    );

    const failure = await createStore(db, { userId }, {
      name: "Sans consentement", slug: "sans-consentement", storeType: "not_a_type",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(
      (failure as { code?: string }).code,
      "consent answers first; the store type is not judged yet",
    ).toBe("consent.required");
  });

  it("lets the type change while a DRAFT, and refuses once published", async () => {
    const seller = await makeSeller();
    const draft = await createStore(db, seller, {
      name: "Change Me", slug: "change-me", storeType: "digital_product",
    });
    const changed = await updateStore(db, seller, draft.id, { storeType: "service" });
    expect(changed.storeType).toBe("service");

    await publishStore(db, seller, draft.id);
    /*
     * Buyers have now seen this store presented as a service, and its
     * offerings were written for that presentation. Turning it into a
     * formation is not an edit; it is a different business.
     */
    await expect(updateStore(db, seller, draft.id, { storeType: "formation" })).rejects.toBeInstanceOf(NotPublishableError);
    const after = await findPublicStore(db, "change-me");
    expect(after?.storeType).toBe("service");
  });
});

describe("store brands", () => {
  it("refuses a palette that is not offered", async () => {
    const seller = await makeSeller();
    await expect(createStore(db, seller, {
        name: "Bad Brand", slug: "bad-brand", storeType: "service", brand: "#ff0000" as never,
      })).rejects.toBeInstanceOf(UnsupportedStoreBrandError);
    expect(() => parseStoreBrand("neon")).toThrow(UnsupportedStoreBrandError);
  });

  it("gives every store an identity, deterministically", () => {
    // Same slug, same brand — so a preview matches what is published.
    expect(defaultBrandFor("atelier-couture")).toBe(defaultBrandFor("atelier-couture"));
    expect(STORE_BRANDS).toContain(defaultBrandFor("anything-at-all"));
  });

  it("defaults rather than leaving a store unstyled", async () => {
    const seller = await makeSeller();
    const store = await createStore(db, seller, {
      name: "No Brand", slug: "no-brand", storeType: "creator",
    });
    expect(STORE_BRANDS).toContain(store.brand);
  });
});

// ---------------------------------------------------------------------------

describe("visibility", () => {
  it("shows a published store to a stranger", async () => {
    const seller = await makeSeller();
    await publishedStore(seller, { name: "Ouverte", slug: "ouverte" });
    expect((await findPublicStore(db, "ouverte"))?.name).toBe("Ouverte");
  });

  it("hides a DRAFT store completely", async () => {
    const seller = await makeSeller();
    await createStore(db, seller, { name: "Cachée", slug: "cachee", storeType: "service" });

    expect(await findPublicStore(db, "cachee")).toBeUndefined();
    expect((await discoverStores(db)).map((s) => s.slug)).not.toContain("cachee");
    expect(await countDiscoverableStores(db)).toBe(0);
  });

  it("hides a SUSPENDED store, and its offerings with it", async () => {
    const seller = await makeSeller();
    const moderator = await makeModerator();
    const store = await publishedStore(seller, { name: "Suspendue", slug: "suspendue" });
    const product = await createProduct(db, seller, {
      storeId: store.id, title: "Guide", slug: "guide", price: money(5000n, "XOF"),
    });
    await giveProductAFile(db, product.id);
    await publishProduct(db, seller, product.id);

    // Visible while published.
    expect(await findPublicStore(db, "suspendue")).toBeDefined();
    expect((await discoverOfferings(db)).map((o) => o.slug)).toContain("guide");

    await suspendStore(db, moderator, store.id, "Contenu signalé");

    expect(await findPublicStore(db, "suspendue")).toBeUndefined();
    expect((await discoverStores(db)).map((s) => s.slug)).not.toContain("suspendue");
    expect(
      (await discoverOfferings(db)).map((o) => o.slug),
      "a published product inside a suspended store is NOT public",
    ).not.toContain("guide");
  });

  it("answers 'not published' and 'does not exist' identically", async () => {
    const seller = await makeSeller();
    await createStore(db, seller, { name: "Draft", slug: "un-brouillon", storeType: "creator" });
    /*
     * Both undefined, deliberately. Telling them apart would let a stranger
     * enumerate which slugs are taken and which sellers have been suspended.
     */
    expect(await findPublicStore(db, "un-brouillon")).toBeUndefined();
    expect(await findPublicStore(db, "jamais-cree")).toBeUndefined();
  });

  it("never exposes the owner or the internal id publicly", async () => {
    const seller = await makeSeller();
    await publishedStore(seller, { name: "Publique", slug: "publique" });
    const store = await findPublicStore(db, "publique");
    expect(store).toBeDefined();
    expect(Object.keys(store ?? {}).sort()).toEqual([
      "brand", "city", "contactPhone", "countryCode", "description", "name",
      "publishedAt", "slug", "storeType", "tagline",
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  /*
   * Review decision, phase 4: an Afrinext store is a commercial IDENTITY, not
   * a container that only becomes real once it holds stock. A seller may claim
   * their name and their public address and share it while they are still
   * preparing what they will sell.
   *
   * The whole risk of that decision is in the second half of this test. An
   * empty storefront is only acceptable while it stays empty and says so — the
   * moment anything fills the silence with an invented product, a fabricated
   * count or a placeholder price, the decision has been implemented wrongly.
   * So this asserts both halves: it publishes, AND it produces nothing.
   */
  it("publishes a store with ZERO offerings, and invents nothing to fill it", async () => {
    const seller = await makeSeller();
    const store = await createStore(db, seller, {
      name: "Boutique Vide", slug: "boutique-vide", storeType: "physical_product",
      tagline: "Bientôt disponible",
    });

    // No products at all. Not a draft product — none.
    const before = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(*) as n from products where store_id = ${store.id}::uuid
    `);
    expect(Number(before.rows[0]?.n)).toBe(0);

    // It publishes. No error, no special case, no offering required.
    const published = await publishStore(db, seller, store.id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    // It is genuinely public: reachable by slug, and present in discovery.
    const publicStore = await findPublicStore(db, "boutique-vide");
    expect(publicStore, "a published empty store is publicly reachable").toBeDefined();
    expect(publicStore?.name).toBe("Boutique Vide");
    expect(
      (await discoverStores(db)).map((s) => s.slug),
      "and it appears in the marketplace listing",
    ).toContain("boutique-vide");

    // ---- and now the half that matters ----

    // Its offering list is EMPTY, not a placeholder.
    expect(await listPublicProducts(db, "boutique-vide")).toEqual([]);

    // Its offering count is a real zero.
    const summary = (await discoverStores(db)).find((s) => s.slug === "boutique-vide");
    expect(summary?.offeringCount, "zero, not a decorative number").toBe(0);

    // It contributes nothing to the offering feed.
    expect(
      (await discoverOfferings(db)).filter((o) => o.storeSlug === "boutique-vide"),
      "an empty store puts nothing in the offerings feed",
    ).toEqual([]);

    // And the database agrees: publishing wrote no product row anywhere.
    const after = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(*) as n from products where store_id = ${store.id}::uuid
    `);
    expect(Number(after.rows[0]?.n), "publishing created no product").toBe(0);

    // It still counts as one store of its type — one, not zero, not two.
    expect(await countStoresByType(db)).toEqual({ physical_product: 1 });
  });

  /*
   * The permissive rule must not have loosened anything else on the way in.
   * An empty store is publishable; it is not therefore publishable by anyone,
   * nor publishable while suspended.
   */
  it("still refuses an empty store to a stranger, and while suspended", async () => {
    const seller = await makeSeller();
    const rival = await makeSeller();
    const moderator = await makeModerator();
    const store = await createStore(db, seller, {
      name: "Vide Gardée", slug: "vide-gardee", storeType: "creator",
    });

    await expect(
      publishStore(db, rival, store.id),
      "empty does not mean unowned",
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await findPublicStore(db, "vide-gardee")).toBeUndefined();

    await publishStore(db, seller, store.id);
    await suspendStore(db, moderator, store.id, "Contenu signalé");
    await expect(
      publishStore(db, seller, store.id),
      "empty does not exempt a store from its suspension",
    ).rejects.toBeInstanceOf(NotPublishableError);
    expect(await findPublicStore(db, "vide-gardee")).toBeUndefined();
  });

  it("stamps published_at once, so republishing cannot jump the queue", async () => {
    const seller = await makeSeller();
    const store = await publishedStore(seller, { name: "Ancienne", slug: "ancienne" });
    const first = (await findPublicStore(db, "ancienne"))?.publishedAt;

    await unpublishStore(db, seller, store.id);
    await publishStore(db, seller, store.id);
    const second = (await findPublicStore(db, "ancienne"))?.publishedAt;

    expect(second?.getTime()).toBe(first?.getTime());
  });

  it("refuses to publish a suspended store", async () => {
    const seller = await makeSeller();
    const moderator = await makeModerator();
    const store = await publishedStore(seller, { name: "S", slug: "suspendue-2" });
    await suspendStore(db, moderator, store.id, "raison");

    await expect(publishStore(db, seller, store.id)).rejects.toBeInstanceOf(NotPublishableError);
    expect(await findPublicStore(db, "suspendue-2")).toBeUndefined();
  });

  it("reinstates to DRAFT, so the owner decides when to go public again", async () => {
    const seller = await makeSeller();
    const moderator = await makeModerator();
    const store = await publishedStore(seller, { name: "R", slug: "reinstate-me" });
    await suspendStore(db, moderator, store.id, "raison");

    const back = await reinstateStore(db, moderator, store.id);
    expect(back.status).toBe("draft");
    expect(
      await findPublicStore(db, "reinstate-me"),
      "reinstating does not republish on the owner's behalf",
    ).toBeUndefined();

    await publishStore(db, seller, store.id);
    expect(await findPublicStore(db, "reinstate-me")).toBeDefined();
  });

  it("records a reason for every suspension", async () => {
    const seller = await makeSeller();
    const moderator = await makeModerator();
    const store = await publishedStore(seller, { name: "A", slug: "audit-me" });

    await expect(suspendStore(db, moderator, store.id, "  ")).rejects.toBeInstanceOf(NotPublishableError);
    await suspendStore(db, moderator, store.id, "Produit contrefait");

    const logs = await db.execute<{ [k: string]: unknown; context: unknown }>(sql`
      select context from audit_logs where action = 'store.suspended'
    `);
    expect(JSON.stringify(logs.rows[0]?.context)).toMatch(/Produit contrefait/);
  });
});

// ---------------------------------------------------------------------------

describe("nobody touches another seller's store", () => {
  it("refuses an update from a different seller", async () => {
    const owner = await makeSeller();
    const stranger = await makeSeller();
    const store = await publishedStore(owner, { name: "Mienne", slug: "mienne" });

    await expect(updateStore(db, stranger, store.id, { name: "Volée" })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(publishStore(db, stranger, store.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(unpublishStore(db, stranger, store.id)).rejects.toBeInstanceOf(PermissionDeniedError);

    expect((await findPublicStore(db, "mienne"))?.name).toBe("Mienne");
  });

  it("refuses suspension by a seller, however senior they feel", async () => {
    const owner = await makeSeller();
    const rival = await makeSeller();
    const store = await publishedStore(owner, { name: "Concurrente", slug: "concurrente" });

    // `store.moderate` is a PLATFORM permission. Owning a store is not it.
    await expect(suspendStore(db, rival, store.id, "je n'aime pas")).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(suspendStore(db, owner, store.id, "auto")).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await findPublicStore(db, "concurrente")).toBeDefined();
  });

  it("never lets an owner id from the input decide whose store is created", async () => {
    const seller = await makeSeller();
    const victim = await makeSeller();
    /*
     * The shape a hand-crafted request would have. TypeScript would reject
     * these fields, which is precisely why the cast is here: the type system
     * is not on the wire, and the runtime must refuse them on its own.
     */
    const smuggled = {
      name: "Smuggle", slug: "smuggle", storeType: "service",
      ownerUserId: victim.userId, owner_user_id: victim.userId, userId: victim.userId,
    } as unknown as Parameters<typeof createStore>[2];

    const store = await createStore(db, seller, smuggled);
    expect(store.ownerUserId).toBe(seller.userId);
    expect(store.ownerUserId).not.toBe(victim.userId);
  });
});

// ---------------------------------------------------------------------------

describe("marketplace discovery", () => {
  it("orders by publication, newest first", async () => {
    const seller = await makeSeller();
    const a = await publishedStore(seller, { name: "Première", slug: "premiere" });
    const b = await publishedStore(seller, { name: "Deuxième", slug: "deuxieme" });
    // Publication order is the real ordering signal; make it unambiguous.
    await db.execute(sql`
      update stores set published_at = now() - interval '1 day' where id = ${a.id}::uuid
    `);
    void b;

    const found = await discoverStores(db, { sort: "newest" });
    expect(found.map((s) => s.slug)).toEqual(["deuxieme", "premiere"]);
  });

  it("filters by type without inventing one", async () => {
    const seller = await makeSeller();
    await publishedStore(seller, { name: "Cours", slug: "cours-x", storeType: "formation" });
    await publishedStore(seller, { name: "Garage", slug: "garage-x", storeType: "service" });

    expect((await discoverStores(db, { type: "formation" })).map((s) => s.slug)).toEqual(["cours-x"]);
    expect(await countDiscoverableStores(db, { type: "service" })).toBe(1);
    expect(await countStoresByType(db)).toEqual({ formation: 1, service: 1 });
  });

  /*
   * The category counts on the marketplace home, and they must be counts of
   * what a visitor can actually reach.
   *
   * A count that included drafts and suspensions would advertise a marketplace
   * larger than the one that exists — "3 boutiques" under a category with one
   * store in it — and every extra would be a shop nobody can open. That is the
   * same fabrication as a fake rating, arriving through arithmetic.
   */
  it("counts only what a visitor can reach, per category", async () => {
    const seller = await makeSeller();
    const moderator = await makeModerator();

    await publishedStore(seller, { name: "Live", slug: "cat-live", storeType: "creator" });
    // A draft of the same type.
    await createStore(db, seller, {
      name: "Draft", slug: "cat-draft", storeType: "creator",
    });
    // And one published then suspended, so it still carries a published_at.
    const gone = await publishedStore(seller, {
      name: "Gone", slug: "cat-gone", storeType: "creator",
    });
    await suspendStore(db, moderator, gone.id, "Contenu signalé");

    expect(
      await countStoresByType(db),
      "one reachable creator store, not three",
    ).toEqual({ creator: 1 });
    // And the two other counts agree with it, because they read the same rule.
    expect(await countDiscoverableStores(db, { type: "creator" })).toBe(1);
    expect((await discoverStores(db, { type: "creator" })).length).toBe(1);
  });

  it("searches name, tagline and description", async () => {
    const seller = await makeSeller();
    await publishedStore(seller, {
      name: "Atelier Couture", slug: "atelier-c", storeType: "service",
      tagline: "Retouches et bazin", description: "Nous travaillons le wax depuis 2014.",
    });
    await publishedStore(seller, { name: "Garage Moderne", slug: "garage-m", storeType: "service" });

    expect((await discoverStores(db, { text: "couture" })).map((s) => s.slug)).toEqual(["atelier-c"]);
    expect((await discoverStores(db, { text: "bazin" })).map((s) => s.slug)).toEqual(["atelier-c"]);
    expect((await discoverStores(db, { text: "wax" })).map((s) => s.slug)).toEqual(["atelier-c"]);
    expect(await discoverStores(db, { text: "introuvable" })).toEqual([]);
  });

  it("treats % and _ as characters, not wildcards", async () => {
    const seller = await makeSeller();
    await publishedStore(seller, { name: "Promo 100% coton", slug: "promo-coton" });
    await publishedStore(seller, { name: "Autre boutique", slug: "autre-b" });

    /*
     * A bare "%" reaching SQL unescaped would match BOTH stores. Escaped, it
     * matches only the name that literally contains one — which is the correct
     * answer, and the one that proves the escape works.
     */
    expect((await discoverStores(db, { text: "%" })).map((s) => s.slug)).toEqual(["promo-coton"]);
    expect((await discoverStores(db, { text: "100% coton" })).map((s) => s.slug))
      .toEqual(["promo-coton"]);
    // "_" matches a single character when unescaped, so it would match both.
    expect((await discoverStores(db, { text: "_" })).length).toBe(0);
  });

  it("counts offerings honestly, including zero", async () => {
    const seller = await makeSeller();
    const store = await publishedStore(seller, { name: "Vide", slug: "vide-store" });

    let found = await discoverStores(db);
    expect(found[0]?.offeringCount, "a store with nothing to sell still appears").toBe(0);

    const product = await createProduct(db, seller, {
      storeId: store.id, title: "Chose", slug: "chose", price: money(1000n, "XOF"),
    });
    // A DRAFT product is not an offering.
    found = await discoverStores(db);
    expect(found[0]?.offeringCount).toBe(0);

    await giveProductAFile(db, product.id);
    await publishProduct(db, seller, product.id);
    found = await discoverStores(db);
    expect(found[0]?.offeringCount).toBe(1);
  });

  it("ranks by REAL paid orders, and by nothing else", async () => {
    const seller = await makeSeller();
    const quiet = await publishedStore(seller, { name: "Calme", slug: "calme" });
    const busy = await publishedStore(seller, { name: "Animée", slug: "animee" });

    // With no sales anywhere, "popular" cannot claim an order of preference:
    // it falls back to recency rather than inventing a ranking.
    const before = await discoverStores(db, { sort: "popular" });
    expect(before.map((s) => s.slug)).toEqual(["animee", "calme"]);

    const buyer = await createTestUser(db, { locale: "fr" });

    /*
     * Three orders for the busy-looking store that are NOT money: a checkout
     * still waiting, one that expired, one that failed. If any of them counted,
     * "popular" would be measuring interest rather than sales — which is the
     * polite way of saying it would be inventing a number.
     */
    for (const [key, status] of [
      ["k-pending", "pending_payment"], ["k-expired", "expired"], ["k-failed", "failed"],
    ] as const) {
      await db.execute(sql`
        insert into orders (id, buyer_user_id, store_id, checkout_key, status, total_minor,
                            currency, expires_at)
        values (gen_random_uuid(), ${buyer}::uuid, ${busy.id}::uuid, ${key}, ${status}, 5000,
                'XOF', now() + interval '1 hour')
      `);
    }
    expect(
      (await discoverStores(db, { sort: "popular" })).map((s) => s.slug),
      "unpaid orders are not sales, so nothing moved",
    ).toEqual(["animee", "calme"]);

    // And now one order that really is money, for the other store.
    await db.execute(sql`
      insert into orders (id, buyer_user_id, store_id, checkout_key, status, total_minor,
                          currency, expires_at, paid_at)
      values (gen_random_uuid(), ${buyer}::uuid, ${quiet.id}::uuid, 'k-paid', 'paid', 5000,
              'XOF', now() + interval '1 hour', now())
    `);

    expect(
      (await discoverStores(db, { sort: "popular" })).map((s) => s.slug),
      "one real paid order outranks three that never paid",
    ).toEqual(["calme", "animee"]);
  });

  it("bounds what a caller can ask for", async () => {
    const seller = await makeSeller();
    for (let i = 0; i < 3; i += 1) {
      await publishedStore(seller, { name: `S${i}`, slug: `bounded-${i}` });
    }
    expect((await discoverStores(db, { limit: 10_000 })).length).toBeLessThanOrEqual(48);
    expect((await discoverStores(db, { limit: -5 })).length).toBe(1);
    expect((await discoverStores(db, { offset: -20, limit: 3 })).length).toBe(3);
  });

  it("only surfaces published offerings from published stores", async () => {
    const seller = await makeSeller();
    const live = await publishedStore(seller, { name: "Live", slug: "live-store" });
    const draftStore = await createStore(db, seller, {
      name: "Draft", slug: "draft-store", storeType: "digital_product",
    });

    const shown = await createProduct(db, seller, {
      storeId: live.id, title: "Visible", slug: "visible", price: money(1000n, "XOF"),
    });
    await giveProductAFile(db, shown.id);
    await publishProduct(db, seller, shown.id);
    await createProduct(db, seller, {
      storeId: live.id, title: "Brouillon", slug: "brouillon", price: money(1000n, "XOF"),
    });
    // Published product, unpublished store: still not public.
    const hidden = await createProduct(db, seller, {
      storeId: draftStore.id, title: "Caché", slug: "cache", price: money(1000n, "XOF"),
    });
    await expect(publishProduct(db, seller, hidden.id)).rejects.toBeInstanceOf(NotPublishableError);

    const offerings = await discoverOfferings(db);
    expect(offerings.map((o) => o.slug)).toEqual(["visible"]);
  });
});
