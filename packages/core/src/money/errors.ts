/** Money errors are their own type so callers can distinguish them from bugs. */
export class MoneyError extends Error {
  override readonly name: string = "MoneyError";
}

export class CurrencyMismatchError extends MoneyError {
  override readonly name = "CurrencyMismatchError";
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} with ${b}: operations require a single currency.`);
  }
}

export class UnknownCurrencyError extends MoneyError {
  override readonly name = "UnknownCurrencyError";
  constructor(code: string) {
    super(`Currency ${code} is not registered. Currencies are data, loaded from the currencies table.`);
  }
}

export class NegativeAmountError extends MoneyError {
  override readonly name = "NegativeAmountError";
  constructor(context: string) {
    super(`${context} requires a non-negative amount.`);
  }
}

export class AllocationError extends MoneyError {
  override readonly name = "AllocationError";
}
