import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { authz, refunds } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { apiError } from "@/lib/api";
import { getPaymentProvider } from "@/lib/payments";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The scheduler endpoint. An authenticated endpoint, and NOT a worker daemon.
 *
 * There is no worker infrastructure in this repository and none was invented:
 * building one would be building a scheduler, not refund logic. What exists is
 * a domain function and a door an external scheduler — a cron, a platform job,
 * an operator with a terminal — can knock on.
 *
 * Two ways in, and neither is weaker than the other:
 *
 *   a signed-in actor holding `refund.execute`, or
 *   a machine token compared in constant time.
 *
 * Being a cron grants nothing extra. The domain function it calls will not
 * start a refund nobody authorised whichever door was used — it only sweeps,
 * resolves and retries work a finance user already set in motion.
 */
function tokenIsValid(header: string | null): boolean {
  const expected = process.env["REFUND_SCHEDULER_TOKEN"];
  // No token configured means no token door. An empty secret must never be a
  // secret that matches an empty header.
  if (expected === undefined || expected === "") return false;
  if (header === null) return false;

  const presented = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Length is compared first because timingSafeEqual throws on a mismatch; the
  // length of a secret is not the secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const db = getDb();

    let permitted = tokenIsValid(request.headers.get("authorization"));
    if (!permitted) {
      const actor = await currentActor();
      if (actor !== undefined && (await authz.can(db, actor, "refund.execute"))) {
        permitted = true;
      }
    }
    if (!permitted) {
      // One answer for "no token", "wrong token" and "wrong permission", so the
      // endpoint cannot be used to learn which of those was the problem.
      return NextResponse.json(
        { error: { code: "authz.denied", message: "Not permitted." } },
        { status: 403 },
      );
    }

    const report = await refunds.processRefundQueue(db, getPaymentProvider());
    return NextResponse.json({ data: report });
  } catch (error: unknown) {
    return apiError(error);
  }
}
