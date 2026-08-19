import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { schema } from "@afrinext/db";
import { ConsentRequiredError } from "../errors";
import { uuidv7 } from "../ids";

export type LegalDocumentKind =
  | "terms_of_use"
  | "privacy_policy"
  | "seller_terms"
  | "instructor_terms"
  | "payment_refund_policy"
  | "payout_terms"
  | "referral_terms"
  | "delivery_terms";

export interface CurrentVersion {
  readonly documentId: string;
  readonly versionId: string;
  readonly kind: string;
  readonly version: string;
  readonly locale: string;
  readonly contentHash: string;
}

/**
 * The version of a document in force right now for a country and locale.
 * A country-specific document wins over the global one.
 */
export async function currentVersions(
  db: Database,
  kinds: readonly LegalDocumentKind[],
  options: { countryCode?: string | undefined; locale: string },
  now: Date = new Date(),
): Promise<CurrentVersion[]> {
  if (kinds.length === 0) return [];

  const rows = await db.execute<{
    document_id: string; version_id: string; kind: string;
    version: string; locale: string; content_hash: string;
  }>(sql`
    select distinct on (d.kind)
           d.id as document_id, v.id as version_id, d.kind,
           v.version, v.locale, v.content_hash
      from legal_documents d
      join legal_document_versions v on v.document_id = d.id
     where d.kind = any(${sql.raw(`array[${kinds.map((k) => `'${k}'`).join(",")}]`)}::text[])
       and v.locale = ${options.locale}
       and v.effective_from <= ${now.toISOString()}
       and (d.country_code is null or d.country_code = ${options.countryCode ?? null})
     order by d.kind,
              -- a country-specific document beats the global fallback
              (d.country_code is not null) desc,
              v.effective_from desc
  `);

  return rows.rows.map((r) => ({
    documentId: r.document_id,
    versionId: r.version_id,
    kind: r.kind,
    version: r.version,
    locale: r.locale,
    contentHash: r.content_hash,
  }));
}

/** Kinds the user has not accepted at their currently effective version. */
export async function outstandingConsents(
  db: Database,
  userId: string,
  kinds: readonly LegalDocumentKind[],
  options: { countryCode?: string | undefined; locale: string },
): Promise<CurrentVersion[]> {
  const current = await currentVersions(db, kinds, options);
  if (current.length === 0) return [];

  const accepted = await db
    .select({ documentVersionId: schema.consentRecords.documentVersionId })
    .from(schema.consentRecords)
    .where(eq(schema.consentRecords.userId, userId));

  const acceptedIds = new Set(accepted.map((a) => a.documentVersionId));
  return current.filter((c) => !acceptedIds.has(c.versionId));
}

/**
 * The gate. Refuses the action server-side and names the documents the client
 * must present — a banner the user can dismiss is not consent enforcement.
 *
 * Publishing a new version therefore re-prompts affected users automatically,
 * because the previously accepted version is no longer the current one.
 */
export async function requireConsent(
  db: Database,
  userId: string,
  kinds: readonly LegalDocumentKind[],
  options: { countryCode?: string | undefined; locale: string },
): Promise<void> {
  const outstanding = await outstandingConsents(db, userId, kinds, options);
  if (outstanding.length > 0) {
    throw new ConsentRequiredError(outstanding.map((o) => o.kind));
  }
}

export interface RecordConsentInput {
  readonly userId: string;
  readonly documentVersionId: string;
  readonly method: "signup" | "seller_onboarding" | "reaccept" | "checkout";
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly locale?: string | undefined;
}

/**
 * Consent records are append-only, like ledger entries and for the same
 * reason: what someone agreed to, and when, must stay provable.
 */
export async function recordConsent(db: Database, input: RecordConsentInput): Promise<string> {
  const id = uuidv7();
  await db
    .insert(schema.consentRecords)
    .values({
      id,
      userId: input.userId,
      documentVersionId: input.documentVersionId,
      method: input.method,
      ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
    })
    .onConflictDoNothing();
  return id;
}

/** Everything a user has ever accepted, newest first. */
export function consentHistory(db: Database, userId: string) {
  return db
    .select({
      recordId: schema.consentRecords.id,
      acceptedAt: schema.consentRecords.acceptedAt,
      method: schema.consentRecords.method,
      kind: schema.legalDocuments.kind,
      version: schema.legalDocumentVersions.version,
      locale: schema.legalDocumentVersions.locale,
      contentHash: schema.legalDocumentVersions.contentHash,
    })
    .from(schema.consentRecords)
    .innerJoin(
      schema.legalDocumentVersions,
      eq(schema.legalDocumentVersions.id, schema.consentRecords.documentVersionId),
    )
    .innerJoin(
      schema.legalDocuments,
      eq(schema.legalDocuments.id, schema.legalDocumentVersions.documentId),
    )
    .where(eq(schema.consentRecords.userId, userId))
    .orderBy(desc(schema.consentRecords.acceptedAt));
}

export const _internal = { and, isNull, or, lte };
