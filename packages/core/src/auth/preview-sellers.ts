/**
 * The preview-only seller grant.
 *
 * ## What it does
 *
 * When `ALLOW_PREVIEW_SELLERS=yes`, a newly provisioned account is granted the
 * real `seller` role — the same row, in the same `role_assignments` table, that
 * an operator would insert by hand. Nothing else changes.
 *
 * ## What it deliberately is NOT
 *
 * It is **not** a bypass. `authorize()` is not touched, `can()` is not touched,
 * and no check anywhere asks whether this flag is set. A preview seller reaches
 * `store.create` by holding a role that grants it, exactly as a production
 * seller does, which is why the preview exercises the real authorization path
 * rather than a parallel one that could pass while production fails.
 *
 * That is also the reason the grant lives at account provisioning rather than
 * inside the permission gate. `authorize()` is the single choke point for every
 * permission in the system; a flag read there is a flag on every check, one
 * refactor away from meaning more than it says. A flag read at provisioning can
 * only ever add a row.
 *
 * ## Its blast radius, exactly
 *
 * The `seller` role holds one permission: `store.create`. It does not hold
 * `store.moderate` (that is `ops` and `superadmin`), any `admin.*` permission,
 * or anything to do with money. `store_owner` is still granted per store by
 * `createStore` in the same transaction as the insert, so ownership scoping is
 * untouched — a preview seller can administer the stores they opened and no
 * others. Seller consent is still required: `createStore` calls
 * `requireSellerConsent` after the permission check, and this grant does not
 * accept any terms on anybody's behalf.
 *
 * ## Why the value must be exactly "yes"
 *
 * Not `Boolean(value)`, not "truthy", not a case-insensitive list. `"false"`,
 * `"no"` and `"0"` are all truthy strings, and a lenient parser is precisely
 * how a preview switch ends up enabled in production by somebody who thought
 * they had turned it off. Anything that is not the exact string `yes` — absent,
 * empty, misspelled, `"YES"`, `"true"`, `"1"` — leaves the ordinary seller
 * control fully in force.
 *
 * ## Never in production
 *
 * An environment with this set hands the ability to open a shop to anybody who
 * can receive an SMS code. That is correct for a demonstration on disposable
 * data and wrong everywhere else. It is set in `render.yaml` for the preview
 * service and must never be set anywhere that serves a real person.
 */
export const PREVIEW_SELLERS_FLAG = "ALLOW_PREVIEW_SELLERS";

/**
 * Read at the moment of use, never cached.
 *
 * Caching it at module load would bake the answer into a build, and a build
 * outlives the environment it was made in.
 */
export function previewSellersEnabled(): boolean {
  return process.env[PREVIEW_SELLERS_FLAG] === "yes";
}
