import { closeDb, databaseUrl, getPool } from "./client";

/**
 * Drops and recreates the public schema. Refuses to run against anything that
 * does not look like a development or test database — a reset script that can
 * reach production is a loaded gun.
 */
async function main(): Promise<void> {
  const url = databaseUrl();
  const looksDisposable = /(_test|localhost|127\.0\.0\.1)/.test(url) && !/prod/i.test(url);
  if (!looksDisposable && process.env["ALLOW_DESTRUCTIVE_RESET"] !== "yes") {
    throw new Error(
      `Refusing to reset ${url.replace(/\/\/[^@]*@/, "//***@")}: it does not look disposable. ` +
        "Set ALLOW_DESTRUCTIVE_RESET=yes only if you are certain.",
    );
  }
  const pool = getPool();
  await pool.query("drop schema if exists public cascade");
  await pool.query("create schema public");
  await pool.query("drop schema if exists drizzle cascade");
  console.log("Schema reset.");
  await closeDb();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
