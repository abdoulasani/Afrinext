import { ProviderNotConfiguredError } from "../errors";
import { IPayMoneyProvider } from "./ipaymoney";
import { MockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./provider";

export type ProviderId = "mock" | "ipaymoney";

/**
 * Resolves the configured provider.
 *
 * The mock is refused in production even if the environment asks for it —
 * a misconfiguration should stop the process, not quietly accept payments that
 * never happened.
 */
export function createPaymentProvider(
  id: string = process.env["PAYMENT_PROVIDER"] ?? "mock",
): PaymentProvider {
  const isProduction = process.env["NODE_ENV"] === "production";

  switch (id) {
    case "mock":
      if (isProduction) {
        throw new ProviderNotConfiguredError(
          "mock",
          "the mock provider is never available in production.",
        );
      }
      return new MockPaymentProvider();
    case "ipaymoney":
      return new IPayMoneyProvider();
    default:
      throw new ProviderNotConfiguredError(id, `no provider is registered under "${id}".`);
  }
}
