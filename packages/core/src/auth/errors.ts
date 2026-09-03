import { DomainError } from "../errors";

export class RateLimitedError extends DomainError {
  override readonly name = "RateLimitedError";
  readonly retryAfterMs: number;
  constructor(what: string, retryAfterMs: number) {
    super(
      "ratelimit.exceeded",
      `Too many ${what} requests. Try again in ${Math.ceil(retryAfterMs / 1000)} second(s).`,
    );
    this.retryAfterMs = retryAfterMs;
  }
}

export class ElevationRequiredError extends DomainError {
  override readonly name = "ElevationRequiredError";
  constructor(action: string) {
    super(
      "auth.elevation_required",
      `"${action}" needs a fresh verification. Confirm the code sent to your phone and retry.`,
    );
  }
}
