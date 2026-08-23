import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * The marketplace, as a stranger sees it.
 *
 * Every assertion here runs with no cookies at all, because "the public can
 * find this" is a claim about anonymous HTTP, not about a signed-in page that
 * happens to look public. The stores are inserted directly rather than driven
 * through the wizard: this spec is about DISCOVERY, and building four stores
 * through four wizards each time would test the wizard four more times and
 * discovery no better.
 *
 * The three things being proved:
 *   1. A published store is reachable and listed; a draft and a suspended one
 *      are neither, and are indistinguishable from a store that never existed.
 *   2. Ordering is by publication date, and searching and type-filtering are
 *      done in SQL rather than by the page filtering a full list.
 *   3. Nothing on the screen is invented — no rating, no follower count, no
 *      "verified" badge, and an offering count that matches the database.
 */

const DB = process.env["DATABASE_URL"] ?? "";

function sql(statement: string): string {
  return execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" }).trim();
}

/** A prefix unique to this run, so the fixtures never collide with other specs. */
const RUN = `mkt${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

type Fixture = {
  slug: string;
  name: string;
  type: string;
  status: string;
  tagline?: string;
};

/**
 * Every store is owned by one throwaway seller. `stores.owner_user_id` is NOT
 * NULL, so this is the smallest honest fixture rather than a shortcut.
 */
function makeOwner(): string {
  return sql(`
    with u as (
      insert into users (id, display_name, locale, status)
      values (gen_random_uuid(), 'Vendeur ${RUN}', 'fr', 'active')
      returning id
    ) select id from u`);
}

/**
 * Inserts one store, publishing it at the current instant.
 *
 * Each call is its own statement, so `now()` advances between them and the
 * insertion order IS the publication order — no hand-picked offsets. That
 * matters: the other specs in this suite publish their own fixtures at `now()`
 * too, and a store dated "ten minutes ago" would sink below them and fall off
 * a page that shows the six newest. These are genuinely the most recently
 * published rows at the moment these tests run, which is what the assertions
 * are actually about.
 */
function insertStore(ownerId: string, f: Fixture): void {
  const tagline = f.tagline === undefined ? "null" : `'${f.tagline.replace(/'/g, "''")}'`;
  const published = f.status === "published" ? "now()" : "null";
  sql(`
    insert into stores (id, owner_user_id, slug, name, tagline, store_type, brand,
                        country_code, city, status, published_at)
    values (gen_random_uuid(), '${ownerId}'::uuid, '${f.slug}', '${f.name}', ${tagline},
            '${f.type}', 'indigo', 'NE', 'Niamey', '${f.status}', ${published})`);
}

function cardSlugs(page: Page): Promise<string[]> {
  return page
    .getByTestId("store-card")
    .locator("a")
    .evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLAnchorElement).getAttribute("href") ?? ""),
    )
    .then((hrefs) => hrefs.map((h) => h.split("/").pop() ?? ""));
}

/** Only this run's fixtures, so a shared database does not make the test lie. */
function oursOnly(slugs: string[]): string[] {
  return slugs.filter((s) => s.startsWith(RUN));
}

let ownerId: string;

test.beforeAll(() => {
  ownerId = makeOwner();

  // Inserted oldest first, so publication order is insertion order.
  insertStore(ownerId, {
    slug: `${RUN}-oldest`, name: `Atelier ${RUN}`, type: "service",
    tagline: "Couture sur mesure", status: "published",
  });
  insertStore(ownerId, {
    slug: `${RUN}-middle`, name: `Academie ${RUN}`, type: "formation",
    tagline: "Bureautique et tableur", status: "published",
  });
  insertStore(ownerId, {
    slug: `${RUN}-newest`, name: `Studio ${RUN}`, type: "creator",
    tagline: "Photographie", status: "published",
  });
  insertStore(ownerId, {
    slug: `${RUN}-draft`, name: `Brouillon ${RUN}`, type: "digital_product",
    status: "draft",
  });

  /*
   * A store that WAS published and then suspended, inserted LAST so it carries
   * the newest `published_at` of them all. That makes it the first row any
   * "newest" query would return if visibility were being decided on the
   * timestamp instead of on the status — so if the suspension ever stops
   * hiding it, it does not merely appear somewhere in the list, it appears at
   * the top of every one of these assertions.
   */
  insertStore(ownerId, {
    slug: `${RUN}-suspended`, name: `Suspendue ${RUN}`, type: "physical_product",
    status: "published",
  });
  sql(`update stores set status = 'suspended', suspended_at = now()
        where slug = '${RUN}-suspended'`);
});

test.afterAll(() => {
  sql(`delete from products where store_id in
         (select id from stores where slug like '${RUN}%')`);
  sql(`delete from stores where slug like '${RUN}%'`);
  sql(`delete from users where id = '${ownerId}'::uuid`);
});

test.describe("the marketplace, anonymously", () => {
  test("lists published stores newest first, and hides the rest", async ({ page }) => {
    await page.goto("/fr/explorer");

    const slugs = oursOnly(await cardSlugs(page));
    expect(slugs, "published stores, most recently published first").toEqual([
      `${RUN}-newest`, `${RUN}-middle`, `${RUN}-oldest`,
    ]);

    // The draft and the suspended store are absent from the listing…
    expect(slugs).not.toContain(`${RUN}-draft`);
    expect(slugs).not.toContain(`${RUN}-suspended`);

    // …and absent from the marketplace home too, which is a different query.
    await page.goto("/fr");
    const home = oursOnly(await cardSlugs(page));
    expect(home).not.toContain(`${RUN}-draft`);
    expect(home).not.toContain(`${RUN}-suspended`);
    expect(home, "the home page shows published stores").toContain(`${RUN}-newest`);
  });

  test("a draft and a suspended store are 404, exactly like one that never existed",
    async ({ page }) => {
      for (const slug of [`${RUN}-draft`, `${RUN}-suspended`, `${RUN}-never-existed`]) {
        const response = await page.goto(`/fr/s/${slug}`, { waitUntil: "commit" });
        expect(response?.status(), `/fr/s/${slug} must be 404`).toBe(404);
      }

      // And a published one is not.
      const ok = await page.goto(`/fr/s/${RUN}-newest`);
      expect(ok?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: `Studio ${RUN}` })).toBeVisible();
    });

  test("searches names and taglines, and keeps the search in the URL", async ({ page }) => {
    await page.goto("/fr/explorer");
    await page.getByRole("searchbox").fill("tableur");
    await page.getByRole("button", { name: "Rechercher" }).click();

    await page.waitForURL(/[?&]q=tableur/);
    expect(oursOnly(await cardSlugs(page)), "matched on the tagline")
      .toEqual([`${RUN}-middle`]);

    // The URL is the state: loading it fresh gives the same result, which is
    // what makes a search result something a person can send to somebody else.
    const shared = await page.context().newPage();
    await shared.goto(`/fr/explorer?q=${RUN}`);
    expect(oursOnly(await cardSlugs(shared)).length,
      "all three published stores match the run prefix in their name").toBe(3);
    await shared.close();
  });

  test("filters by store type, and ignores a type that does not exist", async ({ page }) => {
    await page.goto(`/fr/explorer?q=${RUN}&type=formation`);
    expect(oursOnly(await cardSlugs(page))).toEqual([`${RUN}-middle`]);

    await page.goto(`/fr/explorer?q=${RUN}&type=creator`);
    expect(oursOnly(await cardSlugs(page))).toEqual([`${RUN}-newest`]);

    // A hand-edited or stale link shows the marketplace rather than an error.
    const bogus = await page.goto(`/fr/explorer?q=${RUN}&type=not_a_type`, {
      waitUntil: "commit",
    });
    expect(bogus?.status()).toBe(200);
    expect(oursOnly(await cardSlugs(page)).length, "an unknown type filters nothing").toBe(3);
  });

  test("shows no invented rating, follower count or verification", async ({ page }) => {
    await page.goto(`/fr/s/${RUN}-newest`);
    const body = await page.locator("body").innerText();

    for (const invented of ["★", "étoile", "avis", "abonné", "vérifié", "Vérifié"]) {
      expect(body, `nothing on this page may claim "${invented}"`).not.toContain(invented);
    }

    /*
     * This store is published and has NOTHING in it, which review decision 1
     * makes a legitimate state rather than a bug: a store is a commercial
     * identity, and a seller may claim their address while still preparing
     * what they will sell.
     *
     * So the page must be honest twice over — it says there is nothing yet,
     * and it shows nothing. A single fabricated row here, or a price with no
     * product behind it, is the failure this whole test exists to catch.
     */
    expect(sql(`select count(*) from products p join stores s on s.id = p.store_id
                 where s.slug = '${RUN}-newest'`)).toBe("0");
    await expect(page.getByText("Aucune offre pour l'instant")).toBeVisible();
    await expect(page.getByText("prépare actuellement ses offres")).toBeVisible();
    expect(body, "an empty storefront shows no price at all").not.toMatch(/XOF/);
    // No link anywhere on the page points at an offering under this store —
    // `/fr/s/<slug>/<something>` — because there is no such thing to link to.
    const offeringLinks = await page
      .locator("a")
      .evaluateAll((nodes, slug: string) =>
        nodes
          .map((n) => (n as HTMLAnchorElement).getAttribute("href") ?? "")
          .filter((href) => new RegExp(`/s/${slug}/.+`).test(href)),
      `${RUN}-newest`);
    expect(offeringLinks, "links to no offering, because it has none").toEqual([]);

    // The card in the listing says the same thing, and not "1".
    await page.goto(`/fr/explorer?q=${RUN}`);
    const card = page.getByTestId("store-card").filter({ hasText: `Studio ${RUN}` });
    await expect(card).toContainText("Aucune offre");
  });

  test("the offering count on a card is the real number of published products",
    async ({ page }) => {
      const storeId = sql(`select id from stores where slug = '${RUN}-middle'`);

      // Two products: one published, one still a draft. The card must count one.
      sql(`insert into products (id, store_id, slug, title, kind, price_minor, currency,
                                 status, published_at)
           values (gen_random_uuid(), '${storeId}'::uuid, 'visible', 'Visible', 'digital',
                   15000, 'XOF', 'published', now()),
                  (gen_random_uuid(), '${storeId}'::uuid, 'cache', 'Caché', 'digital',
                   15000, 'XOF', 'draft', null)`);

      await page.goto(`/fr/explorer?q=${RUN}`);
      const card = page.getByTestId("store-card").filter({ hasText: `Academie ${RUN}` });
      await expect(card, "one published product, not two").toContainText("1 offre");

      // The draft product is not reachable either.
      const draft = await page.goto(`/fr/s/${RUN}-middle/cache`, { waitUntil: "commit" });
      expect(draft?.status()).toBe(404);
    });
});
