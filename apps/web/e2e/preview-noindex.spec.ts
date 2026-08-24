import { expect, test } from "@playwright/test";

/**
 * The preview environment asks not to be indexed.
 *
 * A fourth browser assertion, and it earns its place for the same reason the
 * other three did: the claim is about what a real server sends over the wire,
 * and the only way to be sure of that is to ask a real server.
 *
 * This suite already runs the way a preview does — `NODE_ENV=production` with
 * `ALLOW_MOCK_PAYMENTS=yes`, set in playwright.config.ts — which is exactly the
 * shape `isNonProductionEnvironment()` recognises. So the deployment that gets
 * `noindex` here is the deployment that gets it on Render.
 *
 * What this is NOT is access control, and nothing here should be read as
 * saying otherwise. A crawler directive is a request to well-behaved robots.
 * The preview's real protection is that its URL is not published, and its real
 * limitations are written down in docs/deployment/render-preview.md.
 */
test.describe("a non-production deployment asks to stay out of search results", () => {
  test("serves a robots.txt that disallows everything", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Disallow:\s*\//i);
    // An "Allow: /" alongside it would undo the whole thing.
    expect(body).not.toMatch(/^Allow:\s*\/\s*$/im);
  });

  test("marks the pages themselves noindex", async ({ page }) => {
    await page.goto("/fr");
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
    await expect(robots).toHaveAttribute("content", /nofollow/);
  });
});
