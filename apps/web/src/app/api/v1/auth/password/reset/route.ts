import { NextResponse } from "next/server";
import { auth as core } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { emailAuthDeps } from "@/lib/email-auth";

export const dynamic = "force-dynamic";

/**
 * Finishes a password reset, and signs every device out.
 *
 * The two failures are told apart on purpose, and only these two. "Your code is
 * wrong" and "that password is too short" are different problems with different
 * fixes, and neither reveals whether an account exists: a caller only reaches
 * this endpoint holding a code, and a wrong code answers the same way whether
 * the address is real or not.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as {
      email?: unknown; code?: unknown; password?: unknown;
    } | null;

    const result = await core.resetPassword(getDb(), await emailAuthDeps(), {
      email: typeof body?.email === "string" ? body.email : "",
      code: typeof body?.code === "string" ? body.code : "",
      newPassword: typeof body?.password === "string" ? body.password : "",
    });

    if (!result.ok) {
      return result.reason === "weak_password"
        ? NextResponse.json(
            {
              error: {
                code: "auth.password_too_short",
                message: `Le mot de passe doit contenir au moins ${core.MIN_PASSWORD_LENGTH} caractères.`,
              },
            },
            { status: 400 },
          )
        : NextResponse.json(
            { error: { code: "auth.otp_invalid", message: "Code invalide ou expiré." } },
            { status: 400 },
          );
    }

    // Every session is gone, including this one. The caller signs in with the
    // password they just chose — the honest ending for a reset.
    return NextResponse.json({ data: { reset: true, sessionsRevoked: true } });
  } catch (error: unknown) {
    return apiError(error);
  }
}
