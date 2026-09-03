import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "@afrinext/db";
import { seedReferenceData } from "../seed/reference";

/**
 * Points the suite at the disposable test database and brings its schema up to
 * date once, before any test file runs.
 */
export default async function setup(): Promise<void> {
  // Load the repository .env if present, so `pnpm test` works without the
  // developer exporting anything. CI supplies the same variables directly.
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const testUrl = process.env["TEST_DATABASE_URL"];
  if (testUrl === undefined || testUrl === "") {
    throw new Error(
      "TEST_DATABASE_URL is not set. The suite refuses to run without it, because it " +
        "truncates every table it touches.",
    );
  }
  if (testUrl === process.env["DATABASE_URL"]) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }
  process.env["DATABASE_URL"] = testUrl;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, "../../../db/migrations");
  await migrate(getDb(), { migrationsFolder });
  // Reference data is read by nearly every test; seed it once, quietly.
  await seedReferenceData(getDb(), { quiet: true });
  await closeDb();
}
