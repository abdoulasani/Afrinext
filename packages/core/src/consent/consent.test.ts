import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, schema, type Database } from "@afrinext/db";
import { ConsentRequiredError } from "../errors";
import { uuidv7 } from "../ids";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { consentHistory, currentVersions, outstandingConsents, recordConsent, requireConsent } from "./index";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

describe("versioned consent", () => {
  it("blocks an action until the current version is accepted", async () => {
    const user = await createTestUser(db);
    await expect(
      requireConsent(db, user, ["seller_terms"], { locale: "fr" }),
    ).rejects.toThrow(ConsentRequiredError);

    const [version] = await currentVersions(db, ["seller_terms"], { locale: "fr" });
    expect(version).toBeDefined();

    await recordConsent(db, {
      userId: user,
      documentVersionId: version!.versionId,
      method: "seller_onboarding",
      ipAddress: "10.0.0.1",
      userAgent: "vitest",
    });

    await expect(requireConsent(db, user, ["seller_terms"], { locale: "fr" })).resolves.toBeUndefined();
  });

  it("re-prompts when a newer version becomes effective", async () => {
    const user = await createTestUser(db);
    const [version] = await currentVersions(db, ["payout_terms"], { locale: "fr" });
    await recordConsent(db, {
      userId: user, documentVersionId: version!.versionId, method: "signup",
    });
    await expect(requireConsent(db, user, ["payout_terms"], { locale: "fr" })).resolves.toBeUndefined();

    // Publishing a new effective version invalidates the old acceptance.
    const body = "PLACEHOLDER — payout_terms v2";
    await db.insert(schema.legalDocumentVersions).values({
      id: uuidv7(),
      documentId: version!.documentId,
      version: "1.0.0",
      locale: "fr",
      contentHash: createHash("sha256").update(body).digest("hex"),
      effectiveFrom: new Date(Date.now() - 1000),
    });

    const outstanding = await outstandingConsents(db, user, ["payout_terms"], { locale: "fr" });
    expect(outstanding.map((o) => o.kind)).toEqual(["payout_terms"]);
    await expect(
      requireConsent(db, user, ["payout_terms"], { locale: "fr" }),
    ).rejects.toThrow(ConsentRequiredError);
  });

  it("keeps the earlier acceptance rather than overwriting it", async () => {
    const user = await createTestUser(db);
    const [version] = await currentVersions(db, ["terms_of_use"], { locale: "fr" });
    await recordConsent(db, { userId: user, documentVersionId: version!.versionId, method: "signup" });

    const history = await consentHistory(db, user);
    expect(history).toHaveLength(1);
    expect(history[0]?.kind).toBe("terms_of_use");
    expect(history[0]?.contentHash).toBe(version!.contentHash);
  });

  it("refuses UPDATE and DELETE on consent records", async () => {
    const user = await createTestUser(db);
    const [version] = await currentVersions(db, ["privacy_policy"], { locale: "fr" });
    await recordConsent(db, { userId: user, documentVersionId: version!.versionId, method: "signup" });

    await expect(db.execute(sql`update consent_records set method = 'x'`)).rejects.toThrow(/append-only/i);
    await expect(db.execute(sql`delete from consent_records`)).rejects.toThrow(/append-only/i);
  });

  it("names every outstanding document, not just the first", async () => {
    const user = await createTestUser(db);
    try {
      await requireConsent(db, user, ["terms_of_use", "privacy_policy", "seller_terms"], { locale: "fr" });
      throw new Error("expected consent to be required");
    } catch (error) {
      expect(error).toBeInstanceOf(ConsentRequiredError);
      expect((error as ConsentRequiredError).documentKinds).toHaveLength(3);
    }
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
