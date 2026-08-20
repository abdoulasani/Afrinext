import { DomainError } from "../errors";

/**
 * Slugs are public identity: they sit in the URL and, once shared, cannot be
 * changed without breaking every link to them. So they are constrained tightly
 * and the same rules run in the database as a check constraint.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Path segments Afrinext uses or may use. A store called "api" would sit under
 * a URL the router already owns; one called "admin" invites a person to trust
 * it. Reserving them costs a seller one rename and costs us nothing.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin", "api", "app", "auth", "browse", "checkout", "dashboard", "help",
  "internal", "login", "logout", "new", "offline", "orders", "pay", "payment",
  "profile", "saved", "sell", "settings", "sign-in", "sign-up", "static",
  "store", "stores", "submit", "support", "system", "wallet", "www",
]);

export class InvalidSlugError extends DomainError {
  override readonly name = "InvalidSlugError";
  constructor(value: string, why: string) {
    super("catalog.invalid_slug", `"${value}" cannot be used in a URL: ${why}`);
  }
}

/**
 * Turns a human name into a candidate slug.
 *
 * Accents are stripped rather than percent-encoded, because "Café Niamey"
 * should become `cafe-niamey` and not `caf%C3%A9-niamey` — the markets this
 * launches into write accented French, and their URLs should stay readable.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assertUsableSlug(value: string, kind: "store" | "product"): void {
  const max = kind === "store" ? 48 : 64;
  if (!SLUG_PATTERN.test(value)) {
    throw new InvalidSlugError(value, "use lowercase letters, digits and single hyphens");
  }
  if (value.length < 3) throw new InvalidSlugError(value, "it must be at least 3 characters");
  if (value.length > max) throw new InvalidSlugError(value, `it must be at most ${max} characters`);
  // Only stores live at the top of a path, so only they collide with our routes.
  if (kind === "store" && RESERVED_SLUGS.has(value)) {
    throw new InvalidSlugError(value, "that name is reserved by Afrinext");
  }
}
