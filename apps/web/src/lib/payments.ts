import { payments } from "@afrinext/core";

/**
 * The process-wide payment provider.
 *
 * A singleton because the mock keeps its charges in memory: a new instance per
 * request would forget the charge it created a moment earlier, and every
 * confirmation would arrive for an unknown reference. A real provider is
 * stateless here and does not care, so the shape is the same either way.
 */
const globalForPayments = globalThis as unknown as {
  afrinextPaymentProvider?: payments.PaymentProvider;
};

/**
 * The mock needs TWO deliberate choices to run under a production build.
 *
 * `PAYMENT_PROVIDER=mock` alone is not enough, because that variable is exactly
 * the one a misconfigured deployment gets wrong. `ALLOW_MOCK_PAYMENTS=yes` is a
 * second, separate statement that this environment is not taking real money —
 * the same two-key pattern `ConsoleSender` uses for verification codes, and for
 * the same reason: accepting orders nobody paid for must require someone to
 * have said so twice.
 */
function mockIsPermitted(): boolean {
  if (process.env["NODE_ENV"] !== "production") return true;
  return process.env["ALLOW_MOCK_PAYMENTS"] === "yes";
}

export function getPaymentProvider(): payments.PaymentProvider {
  if (globalForPayments.afrinextPaymentProvider !== undefined) {
    return globalForPayments.afrinextPaymentProvider;
  }

  const id = process.env["PAYMENT_PROVIDER"] ?? "mock";
  if (id === "mock" && !mockIsPermitted()) {
    throw new Error(
      "The mock payment provider is not permitted here. Set PAYMENT_PROVIDER to a " +
        "real provider, or set ALLOW_MOCK_PAYMENTS=yes if this environment is " +
        "deliberately not taking real money.",
    );
  }

  const provider =
    id === "mock"
      ? new payments.MockPaymentProvider({
          ...(process.env["MOCK_WEBHOOK_SECRET"] !== undefined
            ? { webhookSecret: process.env["MOCK_WEBHOOK_SECRET"] }
            : {}),
        })
      : payments.createPaymentProvider(id);

  globalForPayments.afrinextPaymentProvider = provider;
  return provider;
}
