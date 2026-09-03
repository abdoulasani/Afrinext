import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, databaseUrl, getDb } from "./client";

async function main(): Promise<void> {
  const url = databaseUrl();
  // Never print credentials, only the host and database being touched.
  const safe = url.replace(/\/\/[^@]*@/, "//***@");
  console.log(`Running migrations against ${safe}`);
  await migrate(getDb(), { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  console.log("Migrations complete.");
  await closeDb();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
