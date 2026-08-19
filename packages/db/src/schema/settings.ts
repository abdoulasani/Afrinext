import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Business rules are data. Nothing here is a constant in application code. */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
