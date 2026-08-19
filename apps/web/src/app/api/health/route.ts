import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@afrinext/db";
import { observability } from "@afrinext/core";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness in one place.
 *
 * Reports whether the database is reachable, how many migrations have been
 * applied and whether reference data is seeded — the three things that are
 * wrong first when a deployment is broken. It deliberately reports no version
 * numbers, hostnames or credentials.
 */
export async function GET(): Promise<NextResponse> {
  const log = observability.logger.child({ route: "/api/health" });
  const startedAt = Date.now();

  try {
    const db = getDb();
    const [migrations, currencies, permissions] = await Promise.all([
      db.execute<{ count: string | bigint }>(
        sql`select count(*)::bigint as count from drizzle.__drizzle_migrations`,
      ),
      db.execute<{ count: string | bigint }>(sql`select count(*)::bigint as count from currencies`),
      db.execute<{ count: string | bigint }>(sql`select count(*)::bigint as count from permissions`),
    ]);

    const body = {
      status: "ok" as const,
      database: "reachable" as const,
      migrationsApplied: Number(migrations.rows[0]?.count ?? 0),
      currenciesSeeded: Number(currencies.rows[0]?.count ?? 0),
      permissionsSeeded: Number(permissions.rows[0]?.count ?? 0),
      // The mock provider is never selectable in production; see the registry.
      paymentProvider: process.env["PAYMENT_PROVIDER"] ?? "mock",
      latencyMs: Date.now() - startedAt,
    };

    log.info("health check passed", { latencyMs: body.latencyMs });
    return NextResponse.json(body);
  } catch (error: unknown) {
    log.error("health check failed", { cause: error });
    return NextResponse.json(
      { status: "degraded", database: "unreachable" },
      { status: 503 },
    );
  }
}
