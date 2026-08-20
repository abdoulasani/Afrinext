import { NextResponse } from "next/server";
import { consent } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { sql } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { clientContext } from "@/lib/consent";
import { getAuth } from "@/lib/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * The one thing a pending account may do: accept the general terms.
 *
 * Deliberately does NOT go through `requireActor`. A `pending_consent` account
 * resolves to no actor — that is the enforcement — so an endpoint that demanded
 * an actor here would be unreachable by exactly the people who need it. It
 * resolves IDENTITY from the session instead, which is a weaker thing and the
 * only thing this action needs: it grants no capability, and it can do nothing
 * to any account but the one the session belongs to.
 */
async function identityFromSession(): Promise<{ userId: string } | undefined> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session === null) return undefined;

  const rows = await getDb().execute<{ id: string }>(sql`
    select id from users where auth_user_id = ${session.session.userId} limit 1
  `);
  const row = rows.rows[0];
  return row === undefined ? undefined : { userId: row.id };
}

export async function GET(): Promise<NextResponse> {
  try {
    const identity = await identityFromSession();
    if (identity === undefined) {
      return NextResponse.json(
        { error: { code: "auth.required", message: "Authentication required." } },
        { status: 401 },
      );
    }
    const state = await consent.accountConsentStatus(getDb(), identity.userId);
    return NextResponse.json({
      data: {
        accountStatus: state.status,
        outstanding: state.outstanding.map((o) => ({
          kind: o.kind, version: o.version, locale: o.locale, contentHash: o.contentHash,
        })),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

/**
 * Accepts both required documents and activates the account.
 *
 * The body names no version and no locale. Both are resolved from the account's
 * own row, server-side, for the reasons the milestone 3 packet set out: a
 * client that could name either could accept something superseded, or point at
 * a locale with no published document.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const identity = await identityFromSession();
    if (identity === undefined) {
      return NextResponse.json(
        { error: { code: "auth.required", message: "Authentication required." } },
        { status: 401 },
      );
    }

    const result = await consent.activateAccountWithConsent(getDb(), identity.userId, {
      method: "signup",
      ...clientContext(await headers()),
    });

    return NextResponse.json({
      data: {
        activated: result.activated,
        accepted: result.accepted.map((a) => ({
          kind: a.kind, version: a.version, newlyRecorded: a.newlyRecorded,
        })),
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
