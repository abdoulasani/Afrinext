import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, schema, type Database } from "@afrinext/db";
import { PermissionDeniedError } from "../errors";
import { uuidv7 } from "../ids";
import { createTestUser, ensureReferenceData, resetData, testDb } from "../test/harness";
import { authorize, authorizeWithdrawalApproval, can, permissionsFor } from "./authorize";
import { ROLE_DEFINITIONS } from "./permissions";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
});

async function grant(userId: string, roleKey: string, scopeId?: string): Promise<void> {
  const role = await db.query.roles.findFirst({ where: (r, { eq: e }) => e(r.key, roleKey) });
  if (role === undefined) throw new Error(`Role ${roleKey} is not seeded.`);
  await db.insert(schema.roleAssignments).values({
    id: uuidv7(),
    userId,
    roleId: role.id,
    scopeType: role.scopeType,
    ...(scopeId !== undefined ? { scopeId } : {}),
  });
}

describe("scoped permissions", () => {
  it("denies everything to a user with no roles", async () => {
    const user = await createTestUser(db);
    expect(await can(db, { userId: user }, "profile.read")).toBe(false);
    await expect(authorize(db, { userId: user }, "profile.read")).rejects.toThrow(PermissionDeniedError);
  });

  it("grants what a global role carries, and nothing else", async () => {
    const user = await createTestUser(db);
    await grant(user, "member");
    expect(await can(db, { userId: user }, "profile.read")).toBe(true);
    expect(await can(db, { userId: user }, "withdrawal.approve")).toBe(false);
  });

  it("confines a scoped role to its own scope", async () => {
    const user = await createTestUser(db);
    const myStore = uuidv7();
    const otherStore = uuidv7();
    await grant(user, "store_owner", myStore);

    expect(await can(db, { userId: user }, "product.publish", { type: "store", id: myStore })).toBe(true);
    // The same permission on somebody else's store must not leak through.
    expect(await can(db, { userId: user }, "product.publish", { type: "store", id: otherStore })).toBe(false);
    expect(await can(db, { userId: user }, "product.publish")).toBe(false);
  });

  it("lets a global grant satisfy a scoped check", async () => {
    const user = await createTestUser(db);
    await grant(user, "ops");
    expect(await can(db, { userId: user }, "product.publish", { type: "store", id: uuidv7() })).toBe(true);
  });

  it("stops honouring a revoked assignment", async () => {
    const user = await createTestUser(db);
    await grant(user, "member");
    expect(await can(db, { userId: user }, "profile.read")).toBe(true);

    await db
      .update(schema.roleAssignments)
      .set({ revokedAt: new Date() })
      .where(eq(schema.roleAssignments.userId, user));

    expect(await can(db, { userId: user }, "profile.read")).toBe(false);
  });

  it("accumulates permissions across several roles", async () => {
    const user = await createTestUser(db);
    await grant(user, "member");
    await grant(user, "finance");
    const held = await permissionsFor(db, { userId: user });
    expect(held).toContain("profile.read");
    expect(held).toContain("withdrawal.approve");
  });
});

describe("separation of duty", () => {
  it("refuses to let anyone approve their own withdrawal", async () => {
    const financeUser = await createTestUser(db);
    await grant(financeUser, "finance");

    const other = await createTestUser(db);
    await expect(
      authorizeWithdrawalApproval(db, { userId: financeUser }, other),
    ).resolves.toBeUndefined();

    // Even holding the permission, a user may not approve a payout to themselves.
    await expect(
      authorizeWithdrawalApproval(db, { userId: financeUser }, financeUser),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("does not give superadmin the power to approve payouts", async () => {
    const admin = await createTestUser(db);
    await grant(admin, "superadmin");
    expect(await can(db, { userId: admin }, "admin.role.grant")).toBe(true);
    // Deliberate: administering roles and moving money are separate capabilities.
    expect(await can(db, { userId: admin }, "withdrawal.approve")).toBe(false);
  });

  it("gives support and ops no financial capability", async () => {
    for (const roleKey of ["support", "ops"]) {
      const user = await createTestUser(db);
      await grant(user, roleKey);
      expect(await can(db, { userId: user }, "withdrawal.approve")).toBe(false);
      expect(await can(db, { userId: user }, "ledger.adjust")).toBe(false);
    }
  });
});

describe("seeded role catalogue", () => {
  it("seeds every declared role and its permissions", async () => {
    for (const definition of ROLE_DEFINITIONS) {
      const role = await db.query.roles.findFirst({
        where: (r, { eq: e }) => e(r.key, definition.key),
      });
      expect(role, `role ${definition.key} is missing`).toBeDefined();

      const rows = await db.execute<{ count: string | bigint }>(
        sql`select count(*)::bigint as count from role_permissions where role_id = ${role?.id}`,
      );
      expect(Number(rows.rows[0]?.count ?? 0)).toBe(definition.permissions.length);
    }
  });
});

describe("teardown", () => {
  it("closes the pool", async () => {
    await closeDb();
    expect(true).toBe(true);
  });
});
