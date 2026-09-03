import { sql } from "drizzle-orm";
import { getAuthTables } from "better-auth/db";
import { beforeAll, describe, expect, it } from "vitest";
import { closeDb, type Database } from "@afrinext/db";
import { ConsoleSender } from "./messaging";
import { createAuth } from "./better-auth";
import { ensureReferenceData, testDb } from "../test/harness";
import { getPool } from "@afrinext/db";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

/**
 * Better Auth's tables live in Afrinext's own migration chain so they are
 * reviewed and rebuilt from zero in CI like everything else. The cost of owning
 * that DDL is that a Better Auth upgrade could expect a shape we no longer have.
 *
 * This test is what makes that cost safe: it asks Better Auth what it expects
 * and compares against the live database. Drift fails here, loudly, rather than
 * at 3am when a sign-in silently stops working.
 */
describe("Better Auth schema drift", () => {
  it("has every table and column Better Auth expects", async () => {
    const auth = createAuth({
      pool: getPool(),
      db,
      sender: new ConsoleSender(),
      baseUrl: "http://localhost:3000",
      secret: "test-secret-not-used-for-anything-real-0123456789",
    });

    const expected = getAuthTables(auth.options);

    const live = await db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
    `);

    const byTable = new Map<string, Set<string>>();
    for (const row of live.rows) {
      const set = byTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      byTable.set(row.table_name, set);
    }

    const missing: string[] = [];
    for (const table of Object.values(expected)) {
      const columns = byTable.get(table.modelName);
      if (columns === undefined) {
        missing.push(`table "${table.modelName}" is absent`);
        continue;
      }
      // Better Auth always expects an id column; it is implicit in the field map.
      if (!columns.has("id")) missing.push(`${table.modelName}.id is absent`);
      for (const [fieldName, field] of Object.entries(table.fields)) {
        const columnName = (field as { fieldName?: string }).fieldName ?? fieldName;
        if (!columns.has(columnName)) {
          missing.push(`${table.modelName}.${columnName} is absent`);
        }
      }
    }

    expect(missing, "Better Auth expects schema this database does not have").toEqual([]);
  });

  it("keeps the Afrinext elevation field Better Auth does not know it needs", async () => {
    const rows = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'session' and column_name = 'elevatedAt'
    `);
    // Payout actions require a fresh re-verification; a long-lived session is
    // never enough on its own.
    expect(rows.rows).toHaveLength(1);
  });

  it("has retired the tables Better Auth now owns", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_name in ('sessions', 'user_identities')
    `);
    // Two session stores would make revocation ambiguous.
    expect(rows.rows.map((r) => r.table_name)).toEqual([]);
  });

  it("keeps authorization out of Better Auth's reach", async () => {
    // Better Auth must never own roles or permissions: authentication answers
    // "who is this?", never "may they?".
    const expectedTables = Object.values(getAuthTables(
      createAuth({
        pool: getPool(), db, sender: new ConsoleSender(),
        baseUrl: "http://localhost:3000", secret: "test-secret-0123456789",
      }).options,
    )).map((t) => t.modelName);

    expect(expectedTables).not.toContain("roles");
    expect(expectedTables).not.toContain("role_assignments");
    expect(expectedTables).not.toContain("permissions");
    await closeDb();
  });
});
