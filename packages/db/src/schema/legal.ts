import { sql } from "drizzle-orm";
import { char, check, index, inet, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

/**
 * Consent establishes the contractual relationship between Afrinext and the
 * user — layer B in the architecture. It does NOT establish regulatory
 * authorization (layer G), and no amount of accepted terms substitutes for it.
 */
export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    countryCode: char("country_code", { length: 2 }), // NULL = applies everywhere
  },
  (t) => [
    uniqueIndex("legal_documents_kind_country_key").on(t.kind, t.countryCode),
    check(
      "legal_documents_kind_valid",
      sql`${t.kind} in ('terms_of_use','privacy_policy','seller_terms','instructor_terms','payment_refund_policy','payout_terms','referral_terms','delivery_terms')`,
    ),
  ],
);

export const legalDocumentVersions = pgTable(
  "legal_document_versions",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id").notNull().references(() => legalDocuments.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    locale: text("locale").notNull(),
    // sha256 of the exact text presented, so what was agreed to is provable.
    contentHash: text("content_hash").notNull(),
    contentUri: text("content_uri"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("legal_document_versions_key").on(t.documentId, t.version, t.locale),
    index("legal_document_versions_effective_idx").on(t.documentId, t.effectiveFrom),
  ],
);

/** Append-only, like ledger entries and for the same reason. */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id").notNull().references(() => legalDocumentVersions.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    locale: text("locale"),
    method: text("method").notNull(), // signup | seller_onboarding | reaccept | checkout
  },
  (t) => [
    uniqueIndex("consent_records_user_version_key").on(t.userId, t.documentVersionId),
    index("consent_records_user_idx").on(t.userId),
  ],
);
