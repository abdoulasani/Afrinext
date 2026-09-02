import { auth as core } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { emailAuthDeps, issueResponse } from "@/lib/email-auth";

export const dynamic = "force-dynamic";

/**
 * Starts a password reset. Answers the same thing for every address.
 *
 * An account exists, does not exist, or is a phone account whose address was
 * invented by signup and can receive nothing: all three answer `sent`. The
 * difference between them is precisely what an attacker enumerating a customer
 * list is measuring, so this endpoint does not contain it — not in the body,
 * not in the status, and not in which requests are rate limited.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email : "";

    const outcome = await core.requestPasswordReset(getDb(), await emailAuthDeps(), { email });
    return issueResponse(outcome);
  } catch (error: unknown) {
    return apiError(error);
  }
}
