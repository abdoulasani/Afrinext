import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { SERVER_LOG } from "../playwright.config";

/**
 * The consent gate, from the position of someone trying to get past it.
 *
 * The point of these tests is NOT that the screen shows a consent panel. It is
 * that the panel is irrelevant to the outcome: the same request, made without
 * ever loading the panel, is refused by the server with 451. A gate that only
 * exists in the interface is a suggestion, and the milestone brief is explicit
 * that displaying a checkbox is not enforcement.
 */

const DB = process.env["DATABASE_URL"] ?? "";

function sqlOne(statement: string): string {
  return execFileSync("psql", [DB, "-Atc", statement], { encoding: "utf8" }).trim();
}

function freshPhone(): string {
  return `+22790${String(Math.floor(100000 + Math.random() * 899999))}`;
}

function logLength(): number {
  try { return readFileSync(SERVER_LOG, "utf8").length; } catch { return 0; }
}

async function codeSentTo(phone: string, since: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  const wanted = new RegExp(`would send to \\${phone}: Afrinext: (\\d{6})`);
  while (Date.now() < deadline) {
    let log = "";
    try { log = readFileSync(SERVER_LOG, "utf8").slice(since); } catch { /* not yet */ }
    const match = wanted.exec(log);
    if (match?.[1] !== undefined) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification code was sent to ${phone} within 15s.`);
}

async function api(
  page: Page,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ([verb, target, payload]) => {
      const response = await fetch(target as string, {
        method: verb as string,
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return { status: response.status, body: await response.json() };
    },
    [method, path, body] as [string, string, unknown],
  );
}

async function signIn(page: Page, phone: string): Promise<string> {
  await page.goto("/fr/sign-in");
  const before = logLength();
  await page.locator('input[type="tel"]').fill(phone);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();
  await page.locator('input[inputmode="numeric"]').fill(await codeSentTo(phone, before));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/wallet$/);
  return sqlOne(
    `select u.id from users u join "user" au on au.id = u.auth_user_id
      where au."phoneNumber" = '${phone}'`,
  );
}

function grantSeller(userId: string): void {
  execFileSync("psql", [DB, "-Atc",
    `insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
     select gen_random_uuid(), '${userId}'::uuid, r.id, 'global', null
       from roles r where r.key = 'seller'`], { encoding: "utf8" });
}

test.describe("consent is a server gate, not a screen", () => {
  test("refuses the API with 451 for a seller who never loaded the consent panel", async ({ page }) => {
    const phone = freshPhone();
    const userId = await signIn(page, phone);
    grantSeller(userId);

    // Straight to the endpoint. This session has never rendered /fr/sell, so
    // no consent UI has ever been shown to it — and that changes nothing.
    const refused = await api(page, "POST", "/api/v1/stores", { name: "Ungated Store" });
    expect(refused.status, "consent is required, and this is where it is enforced").toBe(451);
    const error = (refused.body as { error: { code: string; message: string } }).error;
    expect(error.code).toBe("consent.required");
    // The refusal names what to present, so the client is not left guessing.
    expect(error.message).toContain("seller_terms");

    // And nothing was written. A gate that refuses after inserting is not a gate.
    expect(sqlOne("select count(*) from stores where name = 'Ungated Store'")).toBe("0");
    expect(sqlOne(`select count(*) from consent_records where user_id = '${userId}'::uuid`)).toBe("0");
  });

  test("the panel is presentation: removing it from the DOM changes nothing", async ({ page }) => {
    const phone = freshPhone();
    const userId = await signIn(page, phone);
    grantSeller(userId);

    await page.goto("/fr/sell");
    await expect(page.getByTestId("consent-gate")).toBeVisible();

    // Delete the gate from the page, exactly as anyone with dev tools could.
    await page.evaluate(() => {
      document.querySelector('[data-testid="consent-gate"]')?.remove();
    });
    await expect(page.getByTestId("consent-gate")).toHaveCount(0);

    // The server has not changed its mind.
    const refused = await api(page, "POST", "/api/v1/stores", { name: "DOM Store" });
    expect(refused.status).toBe(451);
    expect(sqlOne("select count(*) from stores where name = 'DOM Store'")).toBe("0");
  });

  test("accepting through the UI records the exact version and opens the gate", async ({ page }) => {
    const phone = freshPhone();
    const userId = await signIn(page, phone);
    grantSeller(userId);

    await page.goto("/fr/sell");
    // The panel names the document and the version being agreed to.
    await expect(page.getByTestId("consent-gate")).toContainText("seller_terms");
    await expect(page.getByTestId("consent-gate")).toContainText("0.0.0-placeholder");

    await page.getByTestId("consent-accept").click();
    await expect(page.getByTestId("consent-gate")).toHaveCount(0);

    // One record, against seller_terms, for this user, with the evidence of how
    // it was collected.
    const recorded = sqlOne(`
      select d.kind || '|' || v.version || '|' || c.method || '|' ||
             (c.user_agent is not null)::text
        from consent_records c
        join legal_document_versions v on v.id = c.document_version_id
        join legal_documents d on d.id = v.document_id
       where c.user_id = '${userId}'::uuid`);
    expect(recorded).toBe("seller_terms|0.0.0-placeholder|seller_onboarding|true");

    // And now the same API call that was 451 succeeds.
    const created = await api(page, "POST", "/api/v1/stores", { name: "Gate Open" });
    expect(created.status).toBe(201);
  });

  test("the API and the form cannot disagree, because both ask the same gate", async ({ page }) => {
    const phone = freshPhone();
    const userId = await signIn(page, phone);
    grantSeller(userId);

    // Accept through the API…
    const accepted = await api(page, "POST", "/api/v1/consent", {});
    expect(accepted.status).toBe(200);

    // …and the FORM path is now open, without that path ever having been used
    // to accept anything. One acceptance, one gate, two transports.
    await page.goto("/fr/sell");
    await expect(page.getByTestId("consent-gate")).toHaveCount(0);
    await expect(page.locator('input[name="name"]')).toBeVisible();

    // Accepting twice records once — the acceptance is of a version, not an
    // event that can be repeated.
    const again = await api(page, "POST", "/api/v1/consent", {});
    expect(again.status).toBe(200);
    expect((again.body as { data: { accepted: { newlyRecorded: boolean }[] } }).data.accepted[0]?.newlyRecorded)
      .toBe(false);
    expect(sqlOne(`select count(*) from consent_records where user_id = '${userId}'::uuid`)).toBe("1");
  });

  test("a new version closes the gate again on the next action", async ({ page }) => {
    const phone = freshPhone();
    const userId = await signIn(page, phone);
    grantSeller(userId);
    await api(page, "POST", "/api/v1/consent", {});

    const first = await api(page, "POST", "/api/v1/stores", { name: "Before New Terms" });
    expect(first.status).toBe(201);

    // An operator publishes new seller terms, effective now.
    execFileSync("psql", [DB, "-Atc", `
      insert into legal_document_versions
        (id, document_id, version, locale, content_hash, effective_from)
      select gen_random_uuid(), d.id, 'e2e-${Date.now()}', v.locale,
             encode(sha256(random()::text::bytea), 'hex'), now() - interval '1 minute'
        from legal_documents d
        join legal_document_versions v on v.document_id = d.id
       where d.kind = 'seller_terms' and v.version = '0.0.0-placeholder'`],
      { encoding: "utf8" });

    // The previous acceptance is still on record and still true — it is simply
    // not an acceptance of what is in force now.
    const second = await api(page, "POST", "/api/v1/stores", { name: "After New Terms" });
    expect(second.status).toBe(451);
    expect(sqlOne("select count(*) from stores where name = 'After New Terms'")).toBe("0");

    // The screen re-prompts without anyone being told to.
    await page.goto("/fr/sell");
    await expect(page.getByTestId("consent-gate")).toBeVisible();

    expect(sqlOne(`select count(*) from consent_records where user_id = '${userId}'::uuid`)).toBe("1");
  });
});
