import { createHash, randomUUID } from "node:crypto";
import type { Database } from "@afrinext/db";
import { schema } from "@afrinext/db";
import { PERMISSIONS, ROLE_DEFINITIONS } from "../authz/index";

/**
 * Seeds reference data and the permission model.
 *
 * Everything here is data the application reads rather than constants it
 * embeds: currencies with their real ISO exponents, the countries Afrinext
 * plans to serve, the permission catalogue and the role definitions.
 *
 * Idempotent — safe to run repeatedly.
 */

const CURRENCIES = [
  { code: "XOF", name: "West African CFA franc", minorUnit: 0, isActive: true },
  { code: "XAF", name: "Central African CFA franc", minorUnit: 0, isActive: true },
  { code: "NGN", name: "Nigerian naira", minorUnit: 2, isActive: false },
  { code: "GHS", name: "Ghanaian cedi", minorUnit: 2, isActive: false },
  { code: "GNF", name: "Guinean franc", minorUnit: 0, isActive: false },
  { code: "EUR", name: "Euro", minorUnit: 2, isActive: false },
  { code: "USD", name: "United States dollar", minorUnit: 2, isActive: false },
];

// Niger launches; the rest are pre-registered so adding a market is a flag flip.
const COUNTRIES = [
  { code: "NE", name: "Niger", currencyCode: "XOF", callingCode: "+227", defaultLocale: "fr", isSupported: true },
  { code: "ML", name: "Mali", currencyCode: "XOF", callingCode: "+223", defaultLocale: "fr", isSupported: false },
  { code: "BF", name: "Burkina Faso", currencyCode: "XOF", callingCode: "+226", defaultLocale: "fr", isSupported: false },
  { code: "SN", name: "Senegal", currencyCode: "XOF", callingCode: "+221", defaultLocale: "fr", isSupported: false },
  { code: "CI", name: "Côte d'Ivoire", currencyCode: "XOF", callingCode: "+225", defaultLocale: "fr", isSupported: false },
  { code: "BJ", name: "Benin", currencyCode: "XOF", callingCode: "+229", defaultLocale: "fr", isSupported: false },
  { code: "TG", name: "Togo", currencyCode: "XOF", callingCode: "+228", defaultLocale: "fr", isSupported: false },
  { code: "GN", name: "Guinea", currencyCode: "GNF", callingCode: "+224", defaultLocale: "fr", isSupported: false },
  { code: "CM", name: "Cameroon", currencyCode: "XAF", callingCode: "+237", defaultLocale: "fr", isSupported: false },
  { code: "NG", name: "Nigeria", currencyCode: "NGN", callingCode: "+234", defaultLocale: "en", isSupported: false },
  { code: "GH", name: "Ghana", currencyCode: "GHS", callingCode: "+233", defaultLocale: "en", isSupported: false },
];

const LOCALES = [
  { code: "fr", name: "Français", isActive: true, sortOrder: 0 },
  { code: "en", name: "English", isActive: true, sortOrder: 1 },
];

/**
 * Launch commission rules. Data, not constants — the admin console will edit
 * these, and a sale resolves them once and freezes the outcome, so changing a
 * rate never rewrites what a seller already earned.
 */
const COMMISSION_RULES = [
  { transactionType: "course", rateBps: 1800, priority: 0 },
  { transactionType: "digital", rateBps: 1800, priority: 0 },
  { transactionType: "service", rateBps: 1500, priority: 0 },
  { transactionType: "physical", rateBps: 1200, priority: 0 },
];

const SETTINGS = [
  { key: "platform.name", value: "Afrinext", description: "Display name of the platform." },
  { key: "platform.operator", value: "AFRI NEXT TECHNOLOGIE", description: "Legal operator (Entreprise Individuelle, Niger)." },
  { key: "commission.default_bps", value: 1800, description: "Default platform commission in basis points." },
  { key: "referral.default_bps", value: 1000, description: "Referral share of Afrinext's commission, in basis points. Never of gross." },
  { key: "referral.levels", value: 1, description: "Referral depth. Single level only — A earns from B, never from B's referrals." },
  { key: "hold.digital_hours", value: 24, description: "Refund window for digital goods before seller funds become available." },
  { key: "hold.course_hours", value: 72, description: "Refund window for courses." },
  { key: "withdrawal.minimum_minor", value: 5000, description: "Minimum withdrawal, in minor units of the wallet currency." },
  { key: "payout.new_account_cooling_hours", value: 24, description: "Delay before a newly added payout account can receive funds." },
];

export async function seedReferenceData(db: Database, options: { quiet?: boolean } = {}): Promise<void> {

  await db.insert(schema.currencies).values(CURRENCIES).onConflictDoNothing();
  await db.insert(schema.locales).values(LOCALES).onConflictDoNothing();
  await db.insert(schema.countries).values(COUNTRIES).onConflictDoNothing();

  await db
    .insert(schema.permissions)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoNothing();

  for (const role of ROLE_DEFINITIONS) {
    const id = randomUUID();
    await db
      .insert(schema.roles)
      .values({ id, key: role.key, description: role.description, scopeType: role.scopeType })
      .onConflictDoNothing();

    const stored = await db.query.roles.findFirst({ where: (r, { eq }) => eq(r.key, role.key) });
    if (stored === undefined) continue;

    await db
      .insert(schema.rolePermissions)
      .values(role.permissions.map((permissionKey) => ({ roleId: stored.id, permissionKey })))
      .onConflictDoNothing();
  }

  for (const rule of COMMISSION_RULES) {
    const existing = await db.query.commissionRules.findFirst({
      where: (r, { and, eq, isNull }) =>
        and(eq(r.transactionType, rule.transactionType), isNull(r.countryCode), isNull(r.storeId)),
    });
    if (existing === undefined) {
      await db.insert(schema.commissionRules).values({
        id: randomUUID(),
        transactionType: rule.transactionType,
        rateBps: rule.rateBps,
        currency: "XOF",
        priority: rule.priority,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      });
    }
  }

  await db
    .insert(schema.platformSettings)
    .values(SETTINGS.map((s) => ({ ...s, value: s.value as unknown as object })))
    .onConflictDoNothing();

  // Legal documents: the machinery and placeholders. The texts themselves are a
  // legal deliverable and are deliberately NOT invented here — the content hash
  // records that these are placeholders, not agreed terms.
  const kinds = [
    "terms_of_use", "privacy_policy", "seller_terms", "instructor_terms",
    "payment_refund_policy", "payout_terms", "referral_terms",
  ] as const;

  for (const kind of kinds) {
    const documentId = randomUUID();
    await db
      .insert(schema.legalDocuments)
      .values({ id: documentId, kind, countryCode: null })
      .onConflictDoNothing();

    const doc = await db.query.legalDocuments.findFirst({
      where: (d, { and, eq, isNull }) => and(eq(d.kind, kind), isNull(d.countryCode)),
    });
    if (doc === undefined) continue;

    for (const locale of ["fr", "en"]) {
      const placeholder = `PLACEHOLDER — ${kind} (${locale}) — text not yet drafted`;
      await db
        .insert(schema.legalDocumentVersions)
        .values({
          id: randomUUID(),
          documentId: doc.id,
          version: "0.0.0-placeholder",
          locale,
          contentHash: createHash("sha256").update(placeholder).digest("hex"),
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        })
        .onConflictDoNothing();
    }
  }

  if (options.quiet !== true) {
    console.log(
      `Seeded ${CURRENCIES.length} currencies, ${COUNTRIES.length} countries, ` +
        `${Object.keys(PERMISSIONS).length} permissions, ${ROLE_DEFINITIONS.length} roles, ` +
        `${SETTINGS.length} settings, ${COMMISSION_RULES.length} commission rules, ` +
        `${kinds.length} legal documents (placeholder texts).`,
    );
  }
}
