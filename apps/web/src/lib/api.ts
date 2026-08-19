import { NextResponse } from "next/server";
import { DomainError, observability } from "@afrinext/core";
import { UnauthenticatedError } from "./session";

/**
 * One error shape for every API route.
 *
 * Clients branch on `code`, never on the message: messages are localised and
 * will change. Unexpected errors are logged with their cause and reported
 * generically, so an internal detail never reaches a caller.
 */
export function apiError(error: unknown): NextResponse {
  const log = observability.logger.child({ component: "api" });

  if (error instanceof UnauthenticatedError) {
    return NextResponse.json({ error: { code: "auth.required", message: error.message } }, { status: 401 });
  }
  if (error instanceof DomainError) {
    const status =
      error.code === "authz.denied" ? 403
      : error.code === "auth.elevation_required" ? 403
      : error.code === "ratelimit.exceeded" ? 429
      : error.code === "consent.required" ? 451
      : 400;
    const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
        },
      },
      { status },
    );
  }

  log.error("unhandled api error", { cause: error });
  return NextResponse.json(
    { error: { code: "internal", message: "Something went wrong." } },
    { status: 500 },
  );
}
