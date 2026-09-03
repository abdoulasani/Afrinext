/** Base class for errors that represent a refused operation, not a bug. */
export class DomainError extends Error {
  override readonly name: string = "DomainError";
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class UnbalancedTransactionError extends DomainError {
  override readonly name = "UnbalancedTransactionError";
  constructor(currency: string, net: bigint) {
    super(
      "ledger.unbalanced",
      `Transaction does not balance in ${currency}: net ${net} minor units. ` +
        "Every transaction must move value between accounts, never create it.",
    );
  }
}

export class IdempotencyConflictError extends DomainError {
  override readonly name = "IdempotencyConflictError";
  constructor(key: string) {
    super(
      "idempotency.conflict",
      `Idempotency key "${key}" was already used with a different request. ` +
        "Reusing a key with different inputs is refused rather than replayed.",
    );
  }
}

export class AccountNotFoundError extends DomainError {
  override readonly name = "AccountNotFoundError";
  constructor(id: string) {
    super("ledger.account_not_found", `Ledger account ${id} does not exist.`);
  }
}

export class PermissionDeniedError extends DomainError {
  override readonly name = "PermissionDeniedError";
  constructor(permission: string, scope: string) {
    super("authz.denied", `Permission "${permission}" is not granted on ${scope}.`);
  }
}

export class ConsentRequiredError extends DomainError {
  override readonly name = "ConsentRequiredError";
  readonly documentKinds: readonly string[];
  constructor(kinds: readonly string[]) {
    super(
      "consent.required",
      `The current version of these documents has not been accepted: ${kinds.join(", ")}.`,
    );
    this.documentKinds = kinds;
  }
}

export class ProviderNotConfiguredError extends DomainError {
  override readonly name = "ProviderNotConfiguredError";
  constructor(provider: string, detail: string) {
    super("payments.provider_not_configured", `Payment provider "${provider}" is not usable: ${detail}`);
  }
}
