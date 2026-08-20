import { sql } from "drizzle-orm";
import type { authz } from "@afrinext/core";
import type { Database } from "@afrinext/db";

/**
 * The legal context an actor's documents are resolved against.
 *
 * Read from the person's own `users` row, never from the request. A caller that
 * could name its own locale could name one with no published document — and
 * before the gate was made to fail closed, that alone would have opened it.
 * Even now, the locale decides WHICH terms apply, which is not a client's
 * decision to make.
 */
export async function actorLegalContext(
  db: Database,
  actor: authz.Actor,
): Promise<{ locale: string; countryCode?: string | undefined }> {
  const rows = await db.execute<{ locale: string; country_code: string | null }>(
    sql`select locale, country_code from users where id = ${actor.userId}::uuid`,
  );
  const person = rows.rows[0];
  if (person === undefined) throw new Error("The signed-in user no longer exists.");
  return {
    locale: person.locale,
    ...(person.country_code !== null ? { countryCode: person.country_code } : {}),
  };
}

/**
 * Evidence of how an acceptance was collected.
 *
 * Recorded because "did this person actually agree?" is a question that gets
 * asked years later, in a dispute, by someone who was not there.
 */
export function clientContext(
  headers: Headers,
): { ipAddress?: string | undefined; userAgent?: string | undefined } {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = headers.get("user-agent") ?? undefined;
  return {
    ...(forwarded !== undefined && forwarded !== "" ? { ipAddress: forwarded } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  };
}
