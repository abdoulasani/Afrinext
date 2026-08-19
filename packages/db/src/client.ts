import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;

/**
 * Postgres returns bigint (int8) as a string by default to avoid precision
 * loss. Money is bigint everywhere in Afrinext, so parse it into a JS BigInt
 * rather than letting a string reach the domain layer.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => BigInt(value));

export function databaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env, or export it in your shell.",
    );
  }
  return url;
}

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: databaseUrl(),
    max: Number(process.env["DATABASE_POOL_MAX"] ?? 10),
    application_name: "afrinext",
  });
  return pool;
}

export function getDb(): Database {
  return drizzle(getPool(), { schema });
}

export async function closeDb(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
  }
}

export { schema };
