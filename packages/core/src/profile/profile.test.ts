import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import type { Actor } from "../authz";
import { acceptCurrentVersions, ACCOUNT_CONSENT_KINDS } from "../consent";
import { createTestUser, ensureReferenceData, messageChain, resetData, testDb } from "../test/harness";
import {
  completeBuyerProfile, InvalidProfileError, isProfileComplete, loadBuyerProfile,
  missingProfileFields, normaliseFullName, ProfileIncompleteError, requireCompleteProfile,
  selectableCountries,
} from "./index";

/**
 * The buyer's own name and country.
 *
 * The interesting cases are not "a name was saved". They are: whose row was
 * written, what a caller can influence, and what happens when two submissions
 * arrive at once.
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

/** An authenticated member whose profile is empty — the state sign-in leaves. */
async function freshMember(): Promise<Actor> {
  const userId = await createTestUser(db, {
    locale: "fr", fullName: null, countryCode: null, phone: `+2279${Math.floor(1000000 + Math.random() * 8999999)}`,
  });
  await grantGlobal(userId, "member");
  await acceptCurrentVersions(db, userId, ACCOUNT_CONSENT_KINDS, { locale: "fr" }, {
    method: "signup",
  });
  return { userId };
}

async function rowOf(userId: string) {
  const rows = await db.execute<{
    [k: string]: unknown; full_name: string | null; country_code: string | null;
  }>(sql`select full_name, country_code from users where id = ${userId}::uuid`);
  return rows.rows[0];
}

// ---------------------------------------------------------------------------

describe("completing a profile", () => {
  it("persists exactly what the person typed", async () => {
    const actor = await freshMember();
    const profile = await completeBuyerProfile(db, actor, {
      fullName: "Aminata Diallo", country: "NE",
    });

    expect(profile.fullName).toBe("Aminata Diallo");
    expect(profile.countryCode).toBe("NE");

    const row = await rowOf(actor.userId);
    expect(row?.full_name).toBe("Aminata Diallo");
    expect(row?.country_code).toBe("NE");
    expect(isProfileComplete(await loadBuyerProfile(db, actor.userId))).toBe(true);
  });

  it("writes the name to full_name and leaves display_name alone", async () => {
    /*
     * display_name already holds the synthetic signup address for every real
     * account. Overwriting it would destroy the evidence of what signup did,
     * and reading it later would be indistinguishable from reading a real name.
     */
    const actor = await freshMember();
    const before = await db.execute<{ [k: string]: unknown; display_name: string | null }>(
      sql`select display_name from users where id = ${actor.userId}::uuid`,
    );
    await completeBuyerProfile(db, actor, { fullName: "Ousmane Ba", country: "NE" });
    const after = await db.execute<{ [k: string]: unknown; display_name: string | null }>(
      sql`select display_name from users where id = ${actor.userId}::uuid`,
    );
    expect(after.rows[0]?.display_name).toBe(before.rows[0]?.display_name);
  });

  it("records the change in the audit log WITHOUT the name itself", async () => {
    const actor = await freshMember();
    await completeBuyerProfile(db, actor, { fullName: "Hadiza Garba", country: "NE" });

    const logs = await db.execute<{ [k: string]: unknown; action: string; context: unknown }>(sql`
      select action, context from audit_logs
       where action = 'profile.completed' and actor_user_id = ${actor.userId}::uuid
    `);
    expect(logs.rows).toHaveLength(1);
    const context = JSON.stringify(logs.rows[0]?.context);
    expect(context).toMatch(/"country":"NE"/);
    expect(context, "personal data is not repeated into an append-only table")
      .not.toMatch(/Hadiza|Garba/);
  });

  it("is idempotent: a retry updates one row and creates no second profile", async () => {
    const actor = await freshMember();
    await completeBuyerProfile(db, actor, { fullName: "Moussa Idé", country: "NE" });
    await completeBuyerProfile(db, actor, { fullName: "Moussa Idé", country: "NE" });

    const rows = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(*) as n from users where id = ${actor.userId}::uuid
    `);
    expect(Number(rows.rows[0]?.n)).toBe(1);
    expect((await rowOf(actor.userId))?.full_name).toBe("Moussa Idé");
  });

  it("stays deterministic when two submissions race", async () => {
    /*
     * There is no separate profile row, so there is nothing to duplicate — the
     * write is one guarded UPDATE against the actor's own row. Both callers
     * succeed and the row holds one of the two values, never a mixture of the
     * name from one and the country from the other.
     */
    const actor = await freshMember();
    await Promise.all([
      completeBuyerProfile(db, actor, { fullName: "Zeinabou Ali", country: "NE" }),
      completeBuyerProfile(db, actor, { fullName: "Zeinabou Ali", country: "BF" }),
    ]);

    const row = await rowOf(actor.userId);
    expect(row?.full_name).toBe("Zeinabou Ali");
    expect(["NE", "BF"]).toContain(row?.country_code);

    const count = await db.execute<{ [k: string]: unknown; n: string }>(sql`
      select count(*) as n from users where id = ${actor.userId}::uuid
    `);
    expect(Number(count.rows[0]?.n)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("what a profile refuses", () => {
  it("refuses a name that is only whitespace", async () => {
    const actor = await freshMember();
    await expect(completeBuyerProfile(db, actor, { fullName: "   ", country: "NE" }))
      .rejects.toBeInstanceOf(InvalidProfileError);
    expect((await rowOf(actor.userId))?.full_name).toBeNull();
  });

  it("refuses a single character, and accepts two", () => {
    expect(() => normaliseFullName("A")).toThrow(InvalidProfileError);
    expect(normaliseFullName("Bo")).toBe("Bo");
  });

  it("refuses a country that is not in the reference table", async () => {
    const actor = await freshMember();
    await expect(completeBuyerProfile(db, actor, { fullName: "Sani Abdou", country: "ZZ" }))
      .rejects.toBeInstanceOf(InvalidProfileError);
    // Nothing partial was written: the name is not saved without the country.
    expect((await rowOf(actor.userId))?.full_name).toBeNull();
  });

  it("refuses a country that is not two letters", async () => {
    const actor = await freshMember();
    await expect(completeBuyerProfile(db, actor, { fullName: "Sani Abdou", country: "NIGER" }))
      .rejects.toBeInstanceOf(InvalidProfileError);
  });

  it("refuses a name longer than the column allows", async () => {
    const actor = await freshMember();
    await expect(
      completeBuyerProfile(db, actor, { fullName: "x".repeat(121), country: "NE" }),
    ).rejects.toBeInstanceOf(InvalidProfileError);
  });

  it("refuses junk even if the domain check were bypassed", async () => {
    /*
     * The CHECK constraint is the backstop. If a future code path wrote the
     * column directly, PostgreSQL still refuses an empty name — the guarantee
     * does not depend on remembering to call the normaliser.
     */
    const actor = await freshMember();
    const failed = await db
      .execute(sql`update users set full_name = ' ' where id = ${actor.userId}::uuid`)
      .catch((e: unknown) => e);
    expect(messageChain(failed)).toMatch(/users_full_name_shape/);
  });
});

// ---------------------------------------------------------------------------

describe("normalising a name without judging it", () => {
  it("trims and collapses whitespace, and changes nothing else", () => {
    expect(normaliseFullName("  Aïcha   Moussa  ")).toBe("Aïcha Moussa");
    expect(normaliseFullName("Jean-Pierre N'Diaye")).toBe("Jean-Pierre N'Diaye");
  });

  it("accepts names this platform will actually meet", () => {
    /*
     * A rule that assumed Latin letters, two words, or no punctuation would
     * reject real people. Niger writes in French, Hausa, Zarma and Arabic.
     */
    for (const name of [
      "Ali", "Mariama Bâ", "عائشة محمد", "Ngozi Okonjo-Iweala",
      "Jean-Baptiste de La Fontaine", "Sœur Marie", "O'Brien", "Иван Петров",
      "李小龙", "Þórunn Jónsdóttir",
    ]) {
      expect(normaliseFullName(name), name).toBe(name);
    }
  });

  it("does not force case", () => {
    expect(normaliseFullName("van der BERG")).toBe("van der BERG");
  });
});

// ---------------------------------------------------------------------------

describe("the gate", () => {
  it("names exactly what is missing", async () => {
    const actor = await freshMember();
    const error = await requireCompleteProfile(db, actor.userId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProfileIncompleteError);
    expect((error as ProfileIncompleteError).missing).toEqual(["full_name", "country"]);
  });

  it("passes once both fields are present", async () => {
    const actor = await freshMember();
    await completeBuyerProfile(db, actor, { fullName: "Abdoul Aziz", country: "NE" });
    await expect(requireCompleteProfile(db, actor.userId)).resolves.toBeDefined();
  });

  it("reports a half-complete profile precisely", async () => {
    const actor = await freshMember();
    await db.execute(sql`
      update users set country_code = 'NE' where id = ${actor.userId}::uuid
    `);
    expect(missingProfileFields(await loadBuyerProfile(db, actor.userId))).toEqual(["full_name"]);
  });
});

// ---------------------------------------------------------------------------

describe("one buyer cannot touch another's profile", () => {
  it("has no user id to change: the actor is the subject", async () => {
    /*
     * The strongest statement available, and it is structural rather than a
     * check somebody has to remember. `completeBuyerProfile` takes an Actor and
     * no user id, so there is no field in any request that names whose row is
     * written. An attacker with a session can only ever describe themselves.
     */
    const victim = await freshMember();
    const attacker = await freshMember();

    await completeBuyerProfile(db, attacker, { fullName: "Attacker Name", country: "BF" });

    const victimRow = await rowOf(victim.userId);
    expect(victimRow?.full_name, "the victim is untouched").toBeNull();
    expect(victimRow?.country_code).toBeNull();

    const attackerRow = await rowOf(attacker.userId);
    expect(attackerRow?.full_name).toBe("Attacker Name");
  });

  it("a caller cannot smuggle a userId through the input object", async () => {
    const victim = await freshMember();
    const attacker = await freshMember();

    await completeBuyerProfile(db, attacker, {
      fullName: "Mallory", country: "NE",
      ...({ userId: victim.userId, id: victim.userId } as unknown as Record<string, never>),
    });

    expect((await rowOf(victim.userId))?.full_name, "still untouched").toBeNull();
    expect((await rowOf(attacker.userId))?.full_name).toBe("Mallory");
  });

  it("refuses an actor with no member role", async () => {
    const userId = await createTestUser(db, { locale: "fr", fullName: null, countryCode: null });
    await expect(
      completeBuyerProfile(db, { userId }, { fullName: "No Role", country: "NE" }),
    ).rejects.toThrow();
    expect((await rowOf(userId))?.full_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("the country list offered to a buyer", () => {
  it("comes from the reference table, supported countries first", async () => {
    const list = await selectableCountries(db);
    expect(list.length).toBeGreaterThan(1);
    expect(list[0]?.code, "the launch market leads").toBe("NE");
    expect(list.every((c) => /^[A-Z]{2}$/.test(c.code))).toBe(true);
  });
});
