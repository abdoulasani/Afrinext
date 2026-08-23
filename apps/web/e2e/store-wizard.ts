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
 */
export async function createStoreViaWizard(
  page: Page,
  { slug, type = "digital_product" }: { slug: string; type?: string },
): Promise<void> {
  await page.goto("/fr/sell/nouvelle");
  await page.getByTestId(`wizard-type-${type}`).click();
  await page.getByTestId("wizard-next").click();
  await page.locator("#store-name").fill(slug);
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-submit").click();
  await page.waitForURL(new RegExp(`/fr/sell/${slug}$`));
}
