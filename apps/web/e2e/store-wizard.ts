import type { Page } from "@playwright/test";

/**
 * Opens a store through the real four-step wizard.
 *
 * Shared by the specs that need a store to exist before testing something else
 * — delivery, mainly. `catalog.spec.ts` deliberately does NOT use this: it
 * walks the wizard step by step with assertions, because there the wizard is
 * the subject rather than the setup.
 *
 * The caller must already be signed in, hold the `seller` role and have
 * accepted the seller terms.
 *
 * `base` exists for the object-storage spec, which drives TWO application
 * instances. Playwright resolves a relative `goto` against `use.baseURL`, so a
 * helper that navigates relatively silently pulls the actor back to the default
 * instance — which is exactly what it did, and it took a debugging round to
 * notice because everything still worked, just on the wrong server. Passing an
 * absolute origin makes the instance explicit; the default keeps every existing
 * caller unchanged.
 */
export async function createStoreViaWizard(
  page: Page,
  { slug, type = "digital_product", base = "" }:
    { slug: string; type?: string; base?: string },
): Promise<void> {
  await page.goto(`${base}/fr/sell/nouvelle`);
  await page.getByTestId(`wizard-type-${type}`).click();
  await page.getByTestId("wizard-next").click();
  await page.locator("#store-name").fill(slug);
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-submit").click();
  await page.waitForURL(new RegExp(`/fr/sell/${slug}$`));
}
