import { closeDb, getDb } from "@afrinext/db";
import { seedReferenceData } from "../src/seed/reference";

async function main(): Promise<void> {
  await seedReferenceData(getDb());
  await closeDb();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
