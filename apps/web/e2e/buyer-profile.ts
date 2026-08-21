import { expect, type Page } from "@playwright/test";

/**
 * Completes the buyer profile that now stands between sign-in and paying.
 *
 * A payment provider asks who is paying, and phone-OTP sign-in proves only that
 * somebody holds a number. Every journey that reaches the pay button therefore
 * passes through this form once, which is the real user path rather than a
 * detour the tests take.
 *
 * Shared rather than copied into each spec: three drifting copies of a step
 * this central is how one of them silently stops asserting anything.
 */
export async function completeBuyerProfile(
  page: Page,
  options: { name?: string; country?: string } = {},
): Promise<void> {
  await expect(
    page.getByTestId("profile-gate"),
    "the pay button is replaced by the profile form until it is filled in",
  ).toBeVisible();

  await page.getByTestId("profile-name").fill(options.name ?? "Aïcha Moussa");
  await page.getByTestId("profile-country").selectOption(options.country ?? "NE");
  await page.getByTestId("profile-save").click();

  // The form is replaced by the pay button, which is how the page says the
  // server accepted it.
  await expect(page.getByTestId("pay")).toBeVisible();
}

/**
 * The same step, for a journey that reached its order through the API.
 *
 * The API pay route is gated identically — `initiatePayment` is the same
 * function behind both — so a test that checks out over HTTP still has to fill
 * this in. It does so through the real form rather than by writing the columns,
 * because "the profile was completed the way a person completes it" is the part
 * worth keeping true.
 */
export async function completeBuyerProfileForOrder(
  page: Page,
  locale: string,
  orderId: string,
  options: { name?: string; country?: string } = {},
): Promise<void> {
  await page.goto(`/${locale}/orders/${orderId}`);
  await completeBuyerProfile(page, options);
}

/**
 * Chooses the payment channel, explicitly.
 *
 * Afrinext offers exactly one at launch and the radio is pre-checked, so this
 * asserts the choice is VISIBLE and selected rather than hidden — a payment
 * method the buyer never saw is not a method they chose. Clicking it anyway
 * exercises the control a second channel would use.
 */
export async function chooseMobileMoney(page: Page): Promise<void> {
  const radio = page.getByTestId("channel-mobile_money");
  await expect(radio, "the launch channel is on screen, not hidden").toBeVisible();
  await expect(radio, "and pre-selected, because there is only one").toBeChecked();
  await radio.check();
}
