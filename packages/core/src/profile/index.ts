import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { DomainError } from "../errors";

/**
 * The buyer's own name and country.
 *
 * This exists because a payment provider asks who is paying and Afrinext had no
 * answer. Sign-in proves possession of a phone; it learns nothing else. The two
 * columns that look like they hold a name — `users.display_name` and Better
 * Auth's `user.name` — hold a synthetic address and the phone string, written
 * at signup to satisfy a NOT NULL. Neither is a name anyone gave.
 *
 * So the person is asked, once, after they are authenticated. What they type is
 * stored on their own `users` row and nowhere else: there is no second identity
 * table, and `users.country_code` — which has existed since the first migration
 * with a foreign key to `countries` and has never had a writer — now has one.
 *
 * Everything here is scoped to the actor. There is no user id parameter on any
 * mutation, so no request can name whose profile to change.
 */

export class ProfileIncompleteError extends DomainError {
  override readonly name = "ProfileIncompleteError";
  readonly missing: readonly ProfileField[];
  constructor(missing: readonly ProfileField[]) {
    super(
      "profile.incomplete",
      `This account still needs: ${missing.join(", ")}. ` +
        "Complete the profile before paying.",
    );
    this.missing = missing;
  }
}

export class InvalidProfileError extends DomainError {
  override readonly name = "InvalidProfileError";
  readonly field: ProfileField;
  constructor(field: ProfileField, why: string) {
    super("profile.invalid", why);
    this.field = field;
  }
}

export type ProfileField = "full_name" | "country";

export interface BuyerProfile {
  readonly fullName: string | undefined;
  readonly countryCode: string | undefined;
  readonly locale: string;
}

/** True when the profile carries everything a charge needs from the buyer. */
export function isProfileComplete(profile: BuyerProfile): boolean {
  return missingProfileFields(profile).length === 0;
}

export function missingProfileFields(profile: BuyerProfile): readonly ProfileField[] {
  const missing: ProfileField[] = [];
  if (profile.fullName === undefined) missing.push("full_name");
  if (profile.countryCode === undefined) missing.push("country");
  return missing;
}

/**
 * The name, normalised but not judged.
 *
 * Leading and trailing space goes, and internal runs of whitespace collapse to
 * one — those are typing accidents, not naming choices. Nothing else is
 * touched. No case is forced, no characters are rejected, no assumption is made
 * about how many parts a name has or which script it is written in. A platform
 * launching in Niger, whose buyers write in French, Hausa, Zarma and Arabic, is
 * the worst possible place to be confident about what a name may look like.
 *
 * The length bounds are the only limits, and they exist to reject an empty
 * string and a paste of an entire document, not to have an opinion.
 */
export function normaliseFullName(raw: string): string {
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  if (collapsed.length < 2) {
    throw new InvalidProfileError("full_name", "Enter your name as you would like it to appear.");
  }
  if (collapsed.length > 120) {
    throw new InvalidProfileError("full_name", "That name is too long.");
  }
  return collapsed;
}

/**
 * The country, checked against the reference table rather than a regex.
 *
 * A two-letter shape is not the requirement — being a country Afrinext knows
 * about is. `countries` is the authority, and an unknown code is refused here
 * rather than at the foreign key so the person gets a sentence instead of a
 * constraint violation.
 *
 * It is NEVER inferred. Not from the phone's calling code — a Nigerien number
 * travels, and a person with a Niamey SIM may be paying from Ouagadougou — and
 * not from the store, whose country is the seller's business, not the payer's.
 */
export async function normaliseCountry(db: Database, raw: string): Promise<string> {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(code)) {
    throw new InvalidProfileError("country", "Choose your country.");
  }
  const rows = await db.execute<{ [k: string]: unknown; code: string }>(sql`
    select code from countries where code = ${code}
  `);
  if (rows.rows[0] === undefined) {
    throw new InvalidProfileError("country", "That country is not one we support yet.");
  }
  return code;
}

/** The actor's own profile. There is no way to ask for anybody else's. */
export async function loadBuyerProfile(db: Database, userId: string): Promise<BuyerProfile> {
  const rows = await db.execute<{
    [k: string]: unknown;
    full_name: string | null;
    country_code: string | null;
    locale: string;
  }>(sql`
    select full_name, country_code, locale from users where id = ${userId}::uuid
  `);
  const row = rows.rows[0];
  return {
    fullName: row?.full_name ?? undefined,
    countryCode: row?.country_code ?? undefined,
    locale: row?.locale ?? "fr",
  };
}

/**
 * The gate a payment passes through.
 *
 * It refuses BEFORE anything is written or sent, which is what makes "no
 * provider request was constructed" true rather than merely likely.
 */
export async function requireCompleteProfile(db: Database, userId: string): Promise<BuyerProfile> {
  const profile = await loadBuyerProfile(db, userId);
  const missing = missingProfileFields(profile);
  if (missing.length > 0) throw new ProfileIncompleteError(missing);
  return profile;
}

export interface CompleteProfileInput {
  readonly fullName: string;
  readonly country: string;
}

/**
 * Records what the person typed, on their own row.
 *
 * Note what is absent from the signature: a user id. The actor IS the subject,
 * so there is no field a request could change to edit somebody else's name —
 * the class of bug where an id in a form body is trusted cannot occur here
 * because the id never leaves the session.
 *
 * The write is a single guarded statement, so two submissions racing each other
 * resolve to one row with one of the two values rather than to a lost update or
 * a duplicate profile. There is no separate profile row to duplicate.
 */
export async function completeBuyerProfile(
  db: Database,
  actor: Actor,
  input: CompleteProfileInput,
): Promise<BuyerProfile> {
  // Any authenticated member may describe themselves. This is not a privileged
  // action; it is the account's own data.
  await authorize(db, actor, "order.create");

  const fullName = normaliseFullName(input.fullName);
  const country = await normaliseCountry(db, input.country);

  const updated = await db.execute<{
    [k: string]: unknown;
    full_name: string | null;
    country_code: string | null;
    locale: string;
  }>(sql`
    update users
       set full_name = ${fullName}, country_code = ${country}, updated_at = now()
     where id = ${actor.userId}::uuid
    returning full_name, country_code, locale
  `);
  const row = updated.rows[0];
  if (row === undefined) throw new ProfileIncompleteError(["full_name", "country"]);

  /*
   * Audited as a change of identity data, with the country recorded and the
   * name NOT recorded.
   *
   * Who changed their country and when is worth keeping — it is the field a
   * payment carries. The name itself is personal data whose repetition in an
   * append-only audit table buys nothing: the current value is one column away,
   * and the log's job here is that a change happened, not what it said.
   */
  await audit(db, {
    actorKind: "user",
    actorUserId: actor.userId,
    action: "profile.completed",
    targetType: "user",
    targetId: actor.userId,
    context: { country, nameLength: fullName.length },
  });

  return {
    fullName: row.full_name ?? undefined,
    countryCode: row.country_code ?? undefined,
    locale: row.locale,
  };
}

/** The countries a person may choose, for the form. */
export async function selectableCountries(
  db: Database,
): Promise<readonly { code: string; name: string }[]> {
  const rows = await db.execute<{ [k: string]: unknown; code: string; name: string }>(sql`
    select code, name from countries order by is_supported desc, name asc
  `);
  return rows.rows.map((r) => ({ code: r.code, name: r.name }));
}
