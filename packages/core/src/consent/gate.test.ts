import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { createProduct, createStore, publishStore } from "../catalog";
import { ConsentRequiredError, PermissionDeniedError } from "../errors";
import { money } from "../money";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import {
  acceptCurrentVersions, ACCOUNT_CONSENT_KINDS, ConsentUnavailableError, consentHistory,
  currentVersions, outstandingConsents, recordConsent, requireConsent,
} from "./index";

/**
 * The consent gate on opening a store.
 *
 * Review decision: `createStore` is the protected action and `seller_terms` is
 * the document. These tests are written from the position of someone trying to
 * open a store without accepting anything, not from the position of someone
 * demonstrating that the happy path works.
 */
let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

async function grantGlobal(userId: string, roleKey: string): Promise<void> {
  await db.execute(sql`
    insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
    select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
      from roles r where r.key = ${roleKey}
  `);
}

/**
 * A seller who has accepted the GENERAL terms but not the seller terms.
 *
 * The account consents are deliberately in place. Without them `createStore`
 * would refuse for the account gate and every assertion below would pass for
 * the wrong reason — the file would prove the seller gate exists while
 * actually exercising a different one.
 */
async function unconsentedSeller(): Promise<Actor> {
  const userId = await createTestUser(db, { locale: "fr" });
  await grantGlobal(userId, "member");
  await grantGlobal(userId, "seller");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  return { userId };
}

async function accept(actor: Actor): Promise<void> {
  await acceptCurrentVersions(db, actor.userId, ["seller_terms"], { locale: "fr" }, {
    method: "seller_onboarding", ipAddress: "10.0.0.7", userAgent: "vitest",
  });
}

/** Seller-terms acceptances only: the account consents are setup, not subject. */
async function sellerTermsRecords(userId: string): Promise<number> {
  const rows = await db.execute<{ n: string }>(sql`
    select count(*)::text as n
      from consent_records c
      join legal_document_versions v on v.id = c.document_version_id
      join legal_documents d on d.id = v.document_id
     where c.user_id = ${userId}::uuid and d.kind = 'seller_terms'
  `);
  return Number(rows.rows[0]!.n);
}

async function storeCount(): Promise<number> {
  const rows = await db.execute<{ n: string }>(sql`select count(*)::text as n from stores`);
  return Number(rows.rows[0]!.n);
}

/** Publishes a newer effective version of a document, as an operator would. */
async function publishNewVersion(kind: string, version: string): Promise<void> {
  await db.execute(sql`
    insert into legal_document_versions
      (id, document_id, version, locale, content_hash, effective_from)
    select gen_random_uuid(), d.id, ${version}, v.locale,
           encode(sha256((${version} || v.locale)::bytea), 'hex'), now() - interval '1 minute'
      from legal_documents d
      join legal_document_versions v on v.document_id = d.id
     where d.kind = ${kind} and v.version = '0.0.0-placeholder'
  `);
}

describe("1 · the protected action is refused without consent", () => {
  it("refuses to open a store, and writes nothing", async () => {
    const actor = await unconsentedSeller();

    // The actor holds store.create. Authorization is satisfied; consent is not.
    // Those are two separate gates and this proves the second one exists.
    await expect(createStore(db, actor, { name: "Sans Accord" }))
      .rejects.toBeInstanceOf(ConsentRequiredError);
    expect(await storeCount()).toBe(0);
  });

  it("names the document the client must present", async () => {
    const actor = await unconsentedSeller();
    try {
      await createStore(db, actor, { name: "Sans Accord" });
      throw new Error("should have been refused");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConsentRequiredError);
      // A refusal that does not say what to present forces the client to guess.
      expect((error as ConsentRequiredError).documentKinds).toEqual(["seller_terms"]);
    }
  });

  it("is a separate gate from authorization, in both directions", async () => {
    // Consented but not a seller: refused for permission, not consent.
    const notSeller = await createTestUser(db, { locale: "fr" });
    await grantGlobal(notSeller, "member");
    await accept({ userId: notSeller });
    await expect(createStore(db, { userId: notSeller }, { name: "No Role" }))
      .rejects.toBeInstanceOf(PermissionDeniedError);

    // Seller but not consented: refused for consent, not permission.
    const notConsented = await unconsentedSeller();
    await expect(createStore(db, notConsented, { name: "No Consent" }))
      .rejects.toBeInstanceOf(ConsentRequiredError);

    expect(await storeCount()).toBe(0);
  });
});

describe("2 · the current version allows the action", () => {
  it("lets the store be opened once the current version is accepted", async () => {
    const actor = await unconsentedSeller();
    await accept(actor);

    const store = await createStore(db, actor, { name: "Avec Accord", slug: "avec-accord" });
    expect(store.slug).toBe("avec-accord");
    expect(await storeCount()).toBe(1);
  });

  it("does not gate anything else in the catalogue", async () => {
    // The gate is on opening a store. Publishing and adding products inherit it
    // implicitly — you cannot publish a store you were never allowed to open —
    // so they are deliberately not gated again.
    const actor = await unconsentedSeller();
    await accept(actor);
    const store = await createStore(db, actor, { name: "Flow", slug: "flow-store" });
    await publishStore(db, actor, store.id);
    await expect(
      createProduct(db, actor, { storeId: store.id, title: "Guide", price: money(5000n, "XOF") }),
    ).resolves.toBeDefined();
  });
});

describe("3 · an old version is not the current one", () => {
  it("refuses again after a newer version becomes effective", async () => {
    const actor = await unconsentedSeller();
    await accept(actor);
    await expect(createStore(db, actor, { name: "First", slug: "first-store" })).resolves.toBeDefined();

    await publishNewVersion("seller_terms", "2026-09-01");

    // The old acceptance is still on record and still true — it just is not an
    // acceptance of what is in force now.
    await expect(createStore(db, actor, { name: "Second", slug: "second-store" }))
      .rejects.toBeInstanceOf(ConsentRequiredError);
    expect(await storeCount()).toBe(1);
  });

  it("accepts the new version and lets the action through again", async () => {
    const actor = await unconsentedSeller();
    await accept(actor);
    await publishNewVersion("seller_terms", "2026-09-01");
    await accept(actor);

    await expect(createStore(db, actor, { name: "After", slug: "after-store" })).resolves.toBeDefined();

    // Both acceptances survive. Which terms bound this person in August has an
    // answer, and it is not overwritten by September's.
    const history = await consentHistory(db, actor.userId);
    const versions = history.filter((h) => h.kind === "seller_terms").map((h) => h.version).sort();
    expect(versions).toEqual(["0.0.0-placeholder", "2026-09-01"]);
  });

  it("cannot be satisfied by accepting a superseded version directly", async () => {
    const actor = await unconsentedSeller();
    const [old] = await currentVersions(db, ["seller_terms"], { locale: "fr" });
    await publishNewVersion("seller_terms", "2026-09-01");

    // Recording the old version id by hand — what a client that chose its own
    // version id could do — must not open the gate.
    await recordConsent(db, {
      userId: actor.userId, documentVersionId: old!.versionId, method: "seller_onboarding",
    });
    await expect(createStore(db, actor, { name: "Stale", slug: "stale-store" }))
      .rejects.toBeInstanceOf(ConsentRequiredError);
  });
});

describe("4 · acceptance is recorded exactly once", () => {
  it("records one row per version however often it is accepted", async () => {
    const actor = await unconsentedSeller();

    const first = await acceptCurrentVersions(db, actor.userId, ["seller_terms"], { locale: "fr" }, {
      method: "seller_onboarding",
    });
    expect(first[0]?.newlyRecorded).toBe(true);

    // Double-submit, a retry, two tabs: the same acceptance of the same version.
    const second = await acceptCurrentVersions(db, actor.userId, ["seller_terms"], { locale: "fr" }, {
      method: "seller_onboarding",
    });
    expect(second[0]?.newlyRecorded).toBe(false);

    expect(await sellerTermsRecords(actor.userId)).toBe(1);
  });

  it("survives simultaneous acceptance without a duplicate", async () => {
    const actor = await unconsentedSeller();
    await Promise.all(
      Array.from({ length: 6 }, () =>
        acceptCurrentVersions(db, actor.userId, ["seller_terms"], { locale: "fr" }, {
          method: "seller_onboarding",
        }),
      ),
    );
    // The unique index on (user, version) is what makes this true, not the
    // read-then-write above it.
    expect(await sellerTermsRecords(actor.userId)).toBe(1);
  });

  it("is append-only, as the database enforces", async () => {
    const actor = await unconsentedSeller();
    await accept(actor);
    await expect(
      db.execute(sql`delete from consent_records where user_id = ${actor.userId}::uuid`),
    ).rejects.toThrow();
  });
});

describe("5 · the record identifies the actor and the version", () => {
  it("carries who, which version, its hash, and how it was collected", async () => {
    const actor = await unconsentedSeller();
    await accept(actor);

    const rows = await db.execute<{
      user_id: string; method: string; ip_address: string | null;
      user_agent: string | null; locale: string | null; version: string; content_hash: string;
    }>(sql`
      select c.user_id, c.method, c.ip_address::text, c.user_agent, c.locale,
             v.version, v.content_hash
        from consent_records c
        join legal_document_versions v on v.id = c.document_version_id
        join legal_documents d on d.id = v.document_id
       where c.user_id = ${actor.userId}::uuid and d.kind = 'seller_terms'
    `);
    const record = rows.rows[0]!;
    expect(record.user_id).toBe(actor.userId);
    expect(record.method).toBe("seller_onboarding");
    // PostgreSQL's inet renders with its prefix length when cast to text.
    expect(record.ip_address).toBe("10.0.0.7/32");
    expect(record.user_agent).toBe("vitest");
    expect(record.locale).toBe("fr");
    // The hash of the exact text shown, so what was agreed to is provable years
    // later even if the document is edited.
    expect(record.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not let one person's acceptance satisfy another's gate", async () => {
    const consented = await unconsentedSeller();
    const other = await unconsentedSeller();
    await accept(consented);

    await expect(createStore(db, other, { name: "Borrowed", slug: "borrowed-store" }))
      .rejects.toBeInstanceOf(ConsentRequiredError);
    await expect(createStore(db, consented, { name: "Own", slug: "own-store" })).resolves.toBeDefined();
  });
});

describe("7 · nobody can consent on someone else's behalf", () => {
  it("records against the actor the caller was resolved as, never a supplied id", async () => {
    const attacker = await unconsentedSeller();
    const victim = await unconsentedSeller();

    // The core API takes a userId, and the only value a transport may pass is
    // the one it resolved from the session — which is what the route and the
    // action both do. This asserts the shape that makes impersonation a
    // transport bug rather than a domain one.
    await acceptCurrentVersions(db, attacker.userId, ["seller_terms"], { locale: "fr" }, {
      method: "seller_onboarding",
    });

    expect(await sellerTermsRecords(victim.userId)).toBe(0);
    await expect(createStore(db, victim, { name: "Victim", slug: "victim-store" }))
      .rejects.toBeInstanceOf(ConsentRequiredError);
  });
});

describe("the gate fails closed", () => {
  it("refuses when the document has no version in the actor's locale", async () => {
    const actor = await unconsentedSeller();
    await db.execute(sql`update users set locale = 'en' where id = ${actor.userId}::uuid`);

    // Switching locale re-opens BOTH gates: the French acceptances are
    // acceptances of the French documents, and this account is now bound by the
    // English ones. English versions exist, so accepting them works.
    await acceptCurrentVersions(db, actor.userId, ACCOUNT_CONSENT_KINDS, { locale: "en" }, {
      method: "reaccept",
    });
    await acceptCurrentVersions(db, actor.userId, ["seller_terms"], { locale: "en" }, {
      method: "seller_onboarding",
    });
    await expect(createStore(db, actor, { name: "English", slug: "english-store" })).resolves.toBeDefined();

    // Now the realistic failure: the English translation is withdrawn while the
    // French one stays. This is a missing-translation incident, not a
    // hypothetical — and a gate that reported "nothing outstanding" here would
    // have been switched off by it.
    //
    // Consent records are append-only, so an accepted version cannot be
    // deleted; withdrawing it means making it no longer effective, which is
    // what an operator would actually do.
    await db.execute(sql`
      update legal_document_versions v
         set effective_from = now() + interval '365 days'
        from legal_documents d
       where d.id = v.document_id and d.kind = 'seller_terms' and v.locale = 'en'
    `);
    await expect(requireConsent(db, actor.userId, ["seller_terms"], { locale: "en" }))
      .rejects.toBeInstanceOf(ConsentUnavailableError);
    await expect(createStore(db, actor, { name: "Gone", slug: "gone-store" }))
      .rejects.toBeInstanceOf(ConsentUnavailableError);

    // And the French speaker next door is unaffected — the gate is per locale,
    // not global.
    const french = await unconsentedSeller();
    await expect(createStore(db, french, { name: "Fr", slug: "fr-store" }))
      .rejects.toBeInstanceOf(ConsentRequiredError);
  });

  it("refuses when the only version is not yet effective", async () => {
    const actor = await unconsentedSeller();
    await db.execute(sql`
      update legal_document_versions v
         set effective_from = now() + interval '30 days'
        from legal_documents d
       where d.id = v.document_id and d.kind = 'seller_terms'
    `);
    await expect(createStore(db, actor, { name: "Future", slug: "future-store" }))
      .rejects.toBeInstanceOf(ConsentUnavailableError);
  });

  it("reports the outstanding document so a client can present it", async () => {
    const actor = await unconsentedSeller();
    const outstanding = await outstandingConsents(db, actor.userId, ["seller_terms"], { locale: "fr" });
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]?.kind).toBe("seller_terms");
    expect(outstanding[0]?.version).toBe("0.0.0-placeholder");
    expect(outstanding[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
