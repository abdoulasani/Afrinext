import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@afrinext/db";
import {
  createTestUser, ensureReferenceData, expectRejection, resetData, testDb,
} from "../test/harness";
import { authorize, can } from "../authz";
import {
  PROGRAMME_PRICES, PROGRAMME_PRICE_SETTING_KEY,
  chooseProgramme, isEntitled, isProgramme, liveSubscription,
  loadProgrammePrice, programmeState,
} from ".";

let db: Database;

beforeAll(async () => {
  db = testDb();
  await ensureReferenceData(db);
});

beforeEach(async () => {
  await resetData(db);
  await db.execute(sql`delete from platform_settings where key = ${PROGRAMME_PRICE_SETTING_KEY}`);
});

async function statusesFor(userId: string): Promise<string[]> {
  const rows = await db.execute<{ status: string }>(sql`
    select status from programme_subscriptions where user_id = ${userId} order by created_at
  `);
  return rows.rows.map((r) => r.status);
}

describe("programme choice", () => {
  it("defaults a new account to the free programme with no subscription", async () => {
    const userId = await createTestUser(db);
    const state = await programmeState(db, userId);
    expect(state).toEqual({ chosen: "vendeur", subscription: null, entitled: false });
  });

  it("records the entrepreneur choice as pending payment and nothing more", async () => {
    const userId = await createTestUser(db);
    const outcome = await chooseProgramme(db, { userId, programme: "entrepreneur" });

    expect(outcome.programme).toBe("entrepreneur");
    expect(outcome.subscription?.status).toBe("pending_payment");

    const state = await programmeState(db, userId);
    expect(state.chosen).toBe("entrepreneur");
    expect(state.subscription?.status).toBe("pending_payment");
    /*
     * The whole point of the separation. Choosing the paid programme is an
     * intent; it is not a payment, and it must never read as one.
     */
    expect(state.entitled).toBe(false);
  });

  it("freezes the price in XOF minor units, which have no decimals", async () => {
    const userId = await createTestUser(db);
    const { subscription } = await chooseProgramme(db, { userId, programme: "entrepreneur" });

    // 2 000 FCFA is 2000n minor units. `200000n` — the reflex from currencies
    // with two decimals — would be a hundred times the price.
    expect(subscription?.price).toEqual({ amountMinor: 2000n, currency: "XOF" });
    expect(PROGRAMME_PRICES.entrepreneur?.price.amountMinor).toBe(2000n);
  });

  it("grants no role and changes no permission", async () => {
    const userId = await createTestUser(db);
    const before = await can(db, { userId }, "store.create");
    await chooseProgramme(db, { userId, programme: "entrepreneur" });
    expect(await can(db, { userId }, "store.create")).toBe(before);

    // And nothing an entrepreneur "gets" is reachable through authorize()
    // because of the choice: authorization still comes from role assignments.
    const roles = await db.execute(sql`
      select 1 from role_assignments where user_id = ${userId}
    `);
    expect(roles.rows).toHaveLength(0);
    await expect(authorize(db, { userId }, "store.create")).rejects.toBeDefined();
  });

  it("is idempotent: a double submit does not create a second subscription", async () => {
    const userId = await createTestUser(db);
    const first = await chooseProgramme(db, { userId, programme: "entrepreneur" });
    const second = await chooseProgramme(db, { userId, programme: "entrepreneur" });

    expect(second.subscription?.id).toBe(first.subscription?.id);
    expect(await statusesFor(userId)).toEqual(["pending_payment"]);
  });

  it("does not restate the price when the choice is repeated after a price change", async () => {
    const userId = await createTestUser(db);
    const first = await chooseProgramme(db, { userId, programme: "entrepreneur" });

    await db.execute(sql`
      insert into platform_settings (key, value, description)
      values (${PROGRAMME_PRICE_SETTING_KEY},
              ${JSON.stringify({ entrepreneur: { priceMinor: 3000, currency: "XOF", periodDays: 30 } })}::jsonb,
              'test')
    `);
    const again = await chooseProgramme(db, { userId, programme: "entrepreneur" });
    // The frozen price is what somebody agreed to. A later setting changes the
    // next subscription, never the one already waiting to be paid.
    expect(again.subscription?.price.amountMinor).toBe(first.subscription?.price.amountMinor);
    expect(again.subscription?.price.amountMinor).toBe(2000n);
  });
});

describe("moving between programmes", () => {
  it("upgrades a vendeur without creating a second account", async () => {
    const userId = await createTestUser(db, { phone: "+22790000001" });
    const authBefore = await db.execute<{ auth_user_id: string | null }>(sql`
      select auth_user_id from users where id = ${userId}
    `);

    await chooseProgramme(db, { userId, programme: "vendeur" });
    await chooseProgramme(db, { userId, programme: "entrepreneur" });

    const rows = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from users
    `);
    expect(Number(rows.rows[0]?.count)).toBe(1);

    const authAfter = await db.execute<{ auth_user_id: string | null }>(sql`
      select auth_user_id from users where id = ${userId}
    `);
    // Same identity throughout: roles, wallet, ledger accounts and orders are
    // all keyed on this id, so upgrading must never mint a new one.
    expect(authAfter.rows[0]?.auth_user_id).toBe(authBefore.rows[0]?.auth_user_id);
    expect((await programmeState(db, userId)).chosen).toBe("entrepreneur");
  });

  it("cancels an unpaid subscription when somebody goes back to the free programme", async () => {
    const userId = await createTestUser(db);
    await chooseProgramme(db, { userId, programme: "entrepreneur" });
    await chooseProgramme(db, { userId, programme: "vendeur" });

    expect(await statusesFor(userId)).toEqual(["cancelled"]);
    expect(await liveSubscription(db, userId)).toBeNull();

    // And the slot is free again, which is what the partial unique index would
    // otherwise have blocked for ever.
    const again = await chooseProgramme(db, { userId, programme: "entrepreneur" });
    expect(again.subscription?.status).toBe("pending_payment");
    expect(await statusesFor(userId)).toEqual(["cancelled", "pending_payment"]);
  });

  it("keeps roles and permissions across a change of programme", async () => {
    const userId = await createTestUser(db);
    await db.execute(sql`
      insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
      select gen_random_uuid(), ${userId}::uuid, r.id, 'global', null
        from roles r where r.key = 'seller'
    `);
    expect(await can(db, { userId }, "store.create")).toBe(true);

    await chooseProgramme(db, { userId, programme: "entrepreneur" });
    expect(await can(db, { userId }, "store.create")).toBe(true);
    await chooseProgramme(db, { userId, programme: "vendeur" });
    expect(await can(db, { userId }, "store.create")).toBe(true);
  });

  it("records the choice in the audit log, saying out loud that nothing activated", async () => {
    const userId = await createTestUser(db);
    await chooseProgramme(db, { userId, programme: "entrepreneur", actorUserId: userId });

    const rows = await db.execute<{ action: string; target_id: string; context: Record<string, unknown> }>(sql`
      select action, target_id, context from audit_logs where action = 'programme.chosen'
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.target_id).toBe(userId);
    expect(rows.rows[0]?.context).toMatchObject({
      programme: "entrepreneur",
      subscriptionStatus: "pending_payment",
      activated: false,
    });
  });
});

describe("entitlement", () => {
  it("is false for pending payment, and for an active row whose period has run out", () => {
    const base = {
      id: "s1", userId: "u1", programme: "entrepreneur" as const,
      price: { amountMinor: 2000n, currency: "XOF" },
      currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-02-01T00:00:00Z"),
      orderId: null,
    };
    const now = new Date("2026-01-15T00:00:00Z");

    expect(isEntitled(null, now)).toBe(false);
    expect(isEntitled({ ...base, status: "pending_payment" }, now)).toBe(false);
    expect(isEntitled({ ...base, status: "past_due" }, now)).toBe(false);
    expect(isEntitled({ ...base, status: "cancelled" }, now)).toBe(false);
    expect(isEntitled({ ...base, status: "active" }, now)).toBe(true);

    // An `active` row nobody expired yet is not entitlement. The clock decides.
    expect(isEntitled({ ...base, status: "active" }, new Date("2026-03-01T00:00:00Z"))).toBe(false);
    // Nor is an `active` row with no period at all — the CHECK constraint
    // forbids writing one, and this refuses to trust it anyway.
    expect(isEntitled({ ...base, status: "active", currentPeriodEnd: null }, now)).toBe(false);
  });

  it("cannot be reached by anything this milestone exposes", async () => {
    /*
     * No payment provider is implemented — iPayMoney is confirmed but its
     * adapter throws rather than pretending — so nothing may set `active`.
     * This test is the guard: if a future change adds a way to activate a
     * subscription without a verified payment, it fails here.
     */
    const userId = await createTestUser(db);
    await chooseProgramme(db, { userId, programme: "entrepreneur" });
    const rows = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from programme_subscriptions where status = 'active'
    `);
    expect(Number(rows.rows[0]?.count)).toBe(0);
    expect((await programmeState(db, userId)).entitled).toBe(false);
  });
});

describe("the database refuses what the code must not write", () => {
  it("rejects a second live subscription for the same person", async () => {
    const userId = await createTestUser(db);
    await chooseProgramme(db, { userId, programme: "entrepreneur" });
    await expectRejection(
      db.execute(sql`
        insert into programme_subscriptions
          (id, user_id, programme, status, price_minor, currency)
        values (gen_random_uuid(), ${userId}, 'entrepreneur', 'pending_payment', 2000, 'XOF')
      `),
      /programme_subscriptions_one_live/,
    );
  });

  it("rejects an active subscription with no billing period", async () => {
    const userId = await createTestUser(db);
    await expectRejection(
      db.execute(sql`
        insert into programme_subscriptions
          (id, user_id, programme, status, price_minor, currency)
        values (gen_random_uuid(), ${userId}, 'entrepreneur', 'active', 2000, 'XOF')
      `),
      /programme_subscriptions_active_has_period/,
    );
  });

  it("rejects a free or negative price", async () => {
    const userId = await createTestUser(db);
    await expectRejection(
      db.execute(sql`
        insert into programme_subscriptions
          (id, user_id, programme, status, price_minor, currency)
        values (gen_random_uuid(), ${userId}, 'entrepreneur', 'pending_payment', 0, 'XOF')
      `),
      /programme_subscriptions_price_positive/,
    );
  });

  it("rejects a programme the application does not know", async () => {
    const userId = await createTestUser(db);
    await expectRejection(
      db.execute(sql`update users set programme = 'platine' where id = ${userId}`),
      /users_programme_valid/,
    );
    expect(isProgramme("platine")).toBe(false);
    expect(isProgramme("vendeur")).toBe(true);
  });
});

describe("pricing is data", () => {
  it("falls back to the reviewed default when no setting is stored", async () => {
    expect(await loadProgrammePrice(db)).toEqual(PROGRAMME_PRICES.entrepreneur);
  });

  it("reads a stored price", async () => {
    await db.execute(sql`
      insert into platform_settings (key, value, description)
      values (${PROGRAMME_PRICE_SETTING_KEY},
              ${JSON.stringify({ entrepreneur: { priceMinor: 2500, currency: "XOF", periodDays: 31 } })}::jsonb,
              'test')
    `);
    const price = await loadProgrammePrice(db);
    expect(price.price.amountMinor).toBe(2500n);
    expect(price.periodDays).toBe(31);
  });

  it("refuses field by field, so a malformed row cannot make the programme free", async () => {
    await db.execute(sql`
      insert into platform_settings (key, value, description)
      values (${PROGRAMME_PRICE_SETTING_KEY},
              ${JSON.stringify({
                entrepreneur: { priceMinor: 0, currency: "xof", periodDays: -3 },
              })}::jsonb,
              'test')
    `);
    const price = await loadProgrammePrice(db);
    expect(price.price.amountMinor).toBe(2000n);
    expect(price.price.currency).toBe("XOF");
    expect(price.periodDays).toBe(30);
  });

  it("ignores a row that is not an object at all", async () => {
    await db.execute(sql`
      insert into platform_settings (key, value, description)
      values (${PROGRAMME_PRICE_SETTING_KEY}, '"free"'::jsonb, 'test')
    `);
    expect(await loadProgrammePrice(db)).toEqual(PROGRAMME_PRICES.entrepreneur);
  });
});
