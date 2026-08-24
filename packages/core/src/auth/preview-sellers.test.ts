import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPool, type Database } from "@afrinext/db";
import { can } from "../authz";
import { createStore } from "../catalog";
import { activateAccountWithConsent, acceptCurrentVersions } from "../consent";
import { PermissionDeniedError } from "../errors";
import { ensureReferenceData, resetData, testDb } from "../test/harness";
import { createAuth } from "./better-auth";
import { ConsoleSender } from "./messaging";
import { PREVIEW_SELLERS_FLAG, previewSellersEnabled } from "./preview-sellers";

/**
 * The preview-only seller grant, from the position of somebody who wants it
 * switched on where it should not be.
 *
 * Every account here is created through the REAL signup path — send a code,
 * verify it, let Better Auth's provisioning hook run. A test that called the
 * grant directly would prove that a function inserts a row; what needs proving
 * is that signing up does or does not produce a seller, and under exactly which
 * conditions.
 *
 * The suite is organised around the three claims that matter:
 *
 *   1. OFF BY DEFAULT — and off for every value that is not exactly "yes".
 *   2. NOT REACHABLE FROM A REQUEST — no field a client can send turns it on.
 *   3. BOUNDED WHEN ON — `seller` and nothing else: no moderation, no admin,
 *      no reach into another person's store.
 */

let db: Database;
let sender: ConsoleSender;
let auth: ReturnType<typeof createAuth>;
let phoneCounter = 0;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  delete process.env[PREVIEW_SELLERS_FLAG];
  sender = new ConsoleSender();
  auth = createAuth({
    pool: getPool(),
    db,
    sender,
    baseUrl: "http://localhost:3000",
    secret: "test-secret-not-used-for-anything-real-0123456789",
  });
});

afterEach(() => {
  // A flag left set would silently arm every suite that runs after this one.
  delete process.env[PREVIEW_SELLERS_FLAG];
});

interface NewAccount {
  userId: string;
  phone: string;
}

/**
 * Signs somebody up the way the application does.
 *
 * `extraBody` is what an attacker would add: the provisioning hook must decide
 * from the process environment and from nothing that travelled with the
 * request, so the suite needs a way to make a request carry a lie.
 */
async function signUp(extraBody: Record<string, unknown> = {}): Promise<NewAccount> {
  phoneCounter += 1;
  const phone = `+2279000${String(2000 + phoneCounter).slice(-4)}`;

  await auth.api.sendPhoneOtp({ body: { phoneNumber: phone, ...extraBody } });
  const code = sender.lastCodeTo(phone);
  expect(code, "a code should have been sent").toBeDefined();
  await auth.api.verifyPhoneOtp({
    body: { phoneNumber: phone, code: code as string, ...extraBody },
  });

  const rows = await db.execute<{ [key: string]: unknown; id: string }>(sql`
    select u.id from users u
      join "user" au on au.id = u.auth_user_id
     where au."phoneNumber" = ${phone}
  `);
  const userId = rows.rows[0]?.id;
  expect(userId, "signing up must have provisioned a domain identity").toBeDefined();

  // A new account is `pending_consent` and resolves to no actor until the
  // general terms are accepted. That gate is proved in consent/signup.test.ts;
  // here it only needs to be passed.
  await activateAccountWithConsent(db, userId!, { method: "signup" });
  return { userId: userId!, phone };
}

/** The roles a user actually holds, read from the table the gate reads. */
async function rolesOf(userId: string): Promise<string[]> {
  const rows = await db.execute<{ [key: string]: unknown; key: string }>(sql`
    select r.key from role_assignments ra
      join roles r on r.id = ra.role_id
     where ra.user_id = ${userId}::uuid and ra.revoked_at is null
     order by r.key
  `);
  return rows.rows.map((r) => r.key);
}

// ===========================================================================

describe("without the flag, nothing changes", () => {
  it("provisions a member who cannot open a store", async () => {
    const account = await signUp();

    expect(await rolesOf(account.userId)).toEqual(["member"]);
    expect(await can(db, { userId: account.userId }, "store.create")).toBe(false);

    await expect(
      createStore(db, { userId: account.userId }, {
        storeType: "digital_product", name: "Boutique refusée",
      }),
      "the seller control is fully in force",
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  /*
   * Every plausible way of saying "on" that is not the word the flag accepts.
   *
   * `"false"`, `"no"` and `"0"` are the ones that matter: all three are truthy
   * strings, so a `Boolean(value)` or an `if (value)` would read every one of
   * them as ENABLED. Somebody who sets ALLOW_PREVIEW_SELLERS=false to turn the
   * preview grant off must get it off.
   */
  it("stays off for every value that is not exactly \"yes\"", async () => {
    for (const value of ["", "false", "no", "0", "1", "true", "YES", "Yes", " yes", "yes "]) {
      process.env[PREVIEW_SELLERS_FLAG] = value;
      expect(previewSellersEnabled(), `"${value}" must not enable the grant`).toBe(false);

      const account = await signUp();
      expect(await rolesOf(account.userId), `"${value}" granted a role`).toEqual(["member"]);
    }
  });

  it("stays off when the variable is absent entirely", async () => {
    delete process.env[PREVIEW_SELLERS_FLAG];
    expect(previewSellersEnabled()).toBe(false);
    expect(await rolesOf((await signUp()).userId)).toEqual(["member"]);
  });
});

// ===========================================================================

describe("the flag cannot be set by anybody making a request", () => {
  /*
   * The hook reads `process.env`. Nothing carried by an HTTP request reaches
   * `process.env`, and this is the test that says so out loud — because the
   * failure it guards against is not exotic: a body field spread into an
   * options object, a header copied into a config, and the switch is public.
   */
  it("ignores the flag when it arrives in the request body", async () => {
    const account = await signUp({
      ALLOW_PREVIEW_SELLERS: "yes",
      allowPreviewSellers: true,
      env: { ALLOW_PREVIEW_SELLERS: "yes" },
      role: "seller",
      roles: ["seller"],
      permissions: ["store.create"],
      isSeller: true,
    });

    expect(await rolesOf(account.userId),
      "a request said it was a preview; the environment did not").toEqual(["member"]);
    expect(await can(db, { userId: account.userId }, "store.create")).toBe(false);
  });

  it("does not let a request name its own role or permission", async () => {
    const account = await signUp({ roleKey: "superadmin", permission: "store.moderate" });
    expect(await rolesOf(account.userId)).toEqual(["member"]);
    for (const permission of ["store.create", "store.moderate", "admin.role.grant"] as const) {
      expect(await can(db, { userId: account.userId }, permission)).toBe(false);
    }
  });

  it("leaves accounts created before the flag exactly as they were", async () => {
    const before = await signUp();
    expect(await rolesOf(before.userId)).toEqual(["member"]);

    process.env[PREVIEW_SELLERS_FLAG] = "yes";
    const after = await signUp();

    expect(await rolesOf(after.userId), "the new account is a seller").toContain("seller");
    expect(await rolesOf(before.userId),
      "the grant happens at provisioning; it is not retroactive").toEqual(["member"]);
  });
});

// ===========================================================================

describe("with the flag on, a new account may open a store and nothing more", () => {
  beforeEach(() => {
    process.env[PREVIEW_SELLERS_FLAG] = "yes";
  });

  it("grants a real, revocable role rather than bypassing the gate", async () => {
    const account = await signUp();
    expect(await rolesOf(account.userId)).toEqual(["member", "seller"]);

    // The permission comes from the role, through the ordinary gate.
    expect(await can(db, { userId: account.userId }, "store.create")).toBe(true);

    // And it is an ordinary row: revoking it takes the permission away, with no
    // reference to the flag, which is still set.
    await db.execute(sql`
      update role_assignments ra set revoked_at = now()
        from roles r
       where r.id = ra.role_id and r.key = 'seller' and ra.user_id = ${account.userId}::uuid
    `);
    expect(await can(db, { userId: account.userId }, "store.create"),
      "a revoked preview grant is as revoked as any other").toBe(false);
  });

  it("still requires the seller terms, which no flag accepts on anyone's behalf",
    async () => {
      const account = await signUp();
      const actor = { userId: account.userId };

      // The permission is held; the consent is not.
      expect(await can(db, actor, "store.create")).toBe(true);
      await expect(
        createStore(db, actor, { storeType: "digital_product", name: "Sans conditions" }),
      ).rejects.toThrow();

      await acceptCurrentVersions(db, account.userId, ["seller_terms"], { locale: "fr" }, {
        method: "signup",
      });
      const store = await createStore(db, actor, {
        storeType: "digital_product", name: "Boutique de test",
      });
      expect(store.status, "and it opens as a draft, like any other").toBe("draft");
    });

  it("grants no moderation and no administrative permission", async () => {
    const account = await signUp();
    const actor = { userId: account.userId };

    for (const permission of [
      "store.moderate", "product.publish", "admin.role.grant", "admin.user.suspend",
      "admin.settings.update", "admin.audit.read", "ledger.read", "ledger.adjust",
      "refund.execute", "withdrawal.approve", "order.refund",
    ] as const) {
      expect(await can(db, actor, permission), `${permission} must not be granted`).toBe(false);
    }
  });

  it("does not reach into a store somebody else opened", async () => {
    const owner = await signUp();
    await acceptCurrentVersions(db, owner.userId, ["seller_terms"], { locale: "fr" }, {
      method: "signup",
    });
    const store = await createStore(db, { userId: owner.userId }, {
      storeType: "digital_product", name: "Boutique du voisin",
    });

    // A second preview seller. Same permission, different store.
    const stranger = await signUp();
    const strangerActor = { userId: stranger.userId };
    expect(await can(db, strangerActor, "store.create")).toBe(true);
    expect(await can(db, strangerActor, "store.update", { type: "store", id: store.id }),
      "store_owner is granted per store, by createStore, to its creator").toBe(false);
    expect(await can(db, { userId: owner.userId }, "store.update", { type: "store", id: store.id }))
      .toBe(true);
  });

  it("records the grant under its own audited action", async () => {
    const account = await signUp();
    const rows = await db.execute<{ [key: string]: unknown; action: string; context: unknown }>(sql`
      select action, context from audit_logs
       where target_id = ${account.userId} order by occurred_at
    `);
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toContain("auth.user.provisioned");
    expect(actions, "a preview grant is distinguishable from an operator's")
      .toContain("auth.user.preview_seller_granted");
    expect(JSON.stringify(rows.rows)).toContain("ALLOW_PREVIEW_SELLERS");
  });
});
