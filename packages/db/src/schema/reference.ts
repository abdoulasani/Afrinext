import { boolean, char, check, integer, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Currencies are data, not constants. `minorUnit` is the ISO 4217 exponent:
 * 0 for XOF and XAF, 2 for NGN and GHS. Application code that assumes 100
 * minor units per major unit is wrong across the entire UEMOA zone.
 */
export const currencies = pgTable(
  "currencies",
  {
    code: char("code", { length: 3 }).primaryKey(),
    name: text("name").notNull(),
    minorUnit: smallint("minor_unit").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [check("currencies_minor_unit_plausible", sql`${t.minorUnit} between 0 and 4`)],
);

/** Countries are rows so a new market is a migration, not a release. */
export const countries = pgTable(
  "countries",
  {
    code: char("code", { length: 2 }).primaryKey(),
    name: text("name").notNull(),
    currencyCode: char("currency_code", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    callingCode: text("calling_code").notNull(),
    defaultLocale: text("default_locale").notNull(),
    isSupported: boolean("is_supported").notNull().default(false),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
  },
  (t) => [check("countries_calling_code_format", sql`${t.callingCode} ~ '^\\+[0-9]{1,4}$'`)],
);

export const locales = pgTable("locales", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});
