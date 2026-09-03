import { NextResponse } from "next/server";
import { auth as core } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { AUTH_REQUIRED, emailAuthDeps, issueResponse, sessionIdentity } from "@/lib/email-auth";

export const dynamic = "force-dynamic";

/**
 * Sends a verification code to the signed-in account's own address.
 *
 * The address is NOT taken from the body. A caller that could name it could
 * make Afrinext send a code to any address it liked, and then verify somebody
 * else's mailbox onto its own account.
 *
 * Verifying changes no permission and unlocks no screen — the dashboard is
 * reachable before it, deliberately — and it is not consent. The consent gate
 * is `users.status`, it is untouched here, and an account that has not accepted
 * the general terms still resolves to no actor whatever this endpoint returns.
 */
export async function POST(): Promise<Response> {
  try {
    const identity = await sessionIdentity();
    if (identity === undefined) return NextResponse.json(AUTH_REQUIRED, { status: 401 });

    // Already verified: nothing to send, and saying so costs nothing because
    // the caller is the account's own session.
    if (identity.emailVerified) return NextResponse.json({ data: { sent: false, verified: true } });

    /*
     * A phone account's synthetic `@phone.afrinext.local` address cannot
     * receive anything. The honest answer is that there is no address to
     * verify, not a code sent into a void.
     */
    if (!core.isReachableEmail(identity.email)) {
      return NextResponse.json(
        {
          error: {
            code: "auth.email_unreachable",
            message: "Aucune adresse e-mail n'est enregistrée sur ce compte.",
          },
        },
        { status: 409 },
      );
    }

    const outcome = await core.requestEmailVerification(getDb(), await emailAuthDeps(), {
      email: identity.email,
      userId: identity.userId,
    });
    return issueResponse(outcome);
  } catch (error: unknown) {
    return apiError(error);
  }
}

/**
 * Confirms a code.
 *
 * Every refusal answers identically — wrong, expired, exhausted, never issued —
 * so the endpoint cannot be used to learn which addresses have codes in flight.
 */
export async function PUT(request: Request): Promise<Response> {
  try {
    const identity = await sessionIdentity();
    if (identity === undefined) return NextResponse.json(AUTH_REQUIRED, { status: 401 });

    const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : "";

    const result = await core.confirmEmailVerification(getDb(), await emailAuthDeps(), {
      email: identity.email,
      code,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "auth.otp_invalid", message: "Code invalide ou expiré." } },
        { status: 400 },
      );
    }
    return NextResponse.json({ data: { verified: true } });
  } catch (error: unknown) {
    return apiError(error);
  }
}
