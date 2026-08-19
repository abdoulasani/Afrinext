import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

/**
 * Better Auth's own endpoints: sign-up, sign-in, phone OTP, session, sign-out.
 *
 * Authentication only. Nothing here grants a capability — every protected route
 * still resolves an Afrinext actor and calls authorize().
 *
 * The handler is built per request rather than at module load: constructing it
 * eagerly would open a database connection during `next build`, which fails in
 * any environment that builds without a database (CI, container images).
 */
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}

export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}
