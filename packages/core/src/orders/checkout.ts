import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { authorize, type Actor } from "../authz";
import { requireAccountConsent } from "../consent";
import { DomainError } from "../errors";
import { uuidv7 } from "../ids";
import { money, type Money } from "../money";
import type { OrderState } from "./state";

/**
 * Checkout: turning a published product into a priced, server-owned order.
 *
 * The whole security argument of this file is what the caller is NOT allowed to
 * say. A checkout request names a store, a product and an idempotency key. It
 * does not carry a price, a currency, a total, a seller or a commission, so
 * there is no client-supplied money value to validate — the values are read
 * from the catalogue under the same visibility rules the public pages use, and
 * the total is arithmetic on those rows.
 */

export class ProductNotPurchasableError extends DomainError {
  override readonly name = "ProductNotPurchasableError";
  constructor(why: string) {
    super("order.not_purchasable", why);
  }
}

export class OrderNotFoundError extends DomainError {
  override readonly name = "OrderNotFoundError";
  constructor(ref: string) {
    super("order.order_not_found", `No order matches "${ref}".`);
  }
}

export class AlreadyOwnedError extends DomainError {
  override readonly name = "AlreadyOwnedError";
  constructor() {
    super("order.already_owned", "You already own this product.");
  }
}

export class CheckoutConflictError extends DomainError {
  override readonly name = "CheckoutConflictError";
  constructor() {
    super(
      "order.checkout_conflict",
      "That checkout key was already used for a different product.",
    );
  }
}

/** How long an unpaid order stays payable. Configuration, not a literal here. */
export const CHECKOUT_TTL_SETTING_KEY = "checkout.ttl_seconds";
export const DEFAULT_CHECKOUT_TTL_SECONDS = 30 * 60;

/**
 * How long after expiry a verified successful payment may still fulfil.
 *
 * Twenty-four hours, and the reason is the market rather than a preference.
 * Mobile-money confirmations in Niger travel through a carrier and an
 * aggregator before they reach us, and a delay of seconds is ordinary while a
 * delay of hours happens. Refusing to fulfil those would take money from
 * people who genuinely paid and hand every one of them to support. Beyond a
 * day, the buyer has moved on — fulfilling then is a surprise, and a refund is
 * the honest answer.
 */
export const LATE_PAYMENT_GRACE_SETTING_KEY = "checkout.late_payment_grace_seconds";
export const DEFAULT_LATE_PAYMENT_GRACE_SECONDS = 24 * 60 * 60;

export async function loadCheckoutTtlSeconds(db: Database): Promise<number> {
  const rows = await db.execute<{ value: unknown }>(sql`
    select value from platform_settings where key = ${CHECKOUT_TTL_SETTING_KEY}
  `);
  const raw = rows.rows[0]?.value;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CHECKOUT_TTL_SECONDS;
}

/**
 * The grace window, read from settings and CLAMPED — never widened.
 *
 * The other settings in this system are read as written. This one is not, and
 * the asymmetry is deliberate: every second of grace is a second in which
 * Afrinext fulfils an order it had already closed, so the reviewed maximum is a
 * ceiling rather than a default. An operator may narrow the window to zero
 * without asking anyone; widening it past a day is a policy change and needs
 * the review that produced the number, not an UPDATE.
 *
 * A malformed row — a string, a negative, NaN, null — is not an instruction. It
 * falls back to the reviewed value rather than to "no limit", because the one
 * thing a broken setting must never do is open the gate wider.
 */
export async function loadLatePaymentGraceSeconds(db: Database): Promise<number> {
  const rows = await db.execute<{ value: unknown }>(sql`
    select value from platform_settings where key = ${LATE_PAYMENT_GRACE_SETTING_KEY}
  `);
  const raw = rows.rows[0]?.value;
  /*
   * A number, or it is not a setting.
   *
   * `Number(null)` is 0, so a coercing read would turn a malformed row into
   * "no grace at all" — a policy change nobody asked for, in the quiet
   * direction. A broken setting means "use the reviewed policy", not "guess".
   */
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return DEFAULT_LATE_PAYMENT_GRACE_SECONDS;
  }
  return Math.min(Math.floor(raw), DEFAULT_LATE_PAYMENT_GRACE_SECONDS);
}

export interface OrderItemRecord {
  readonly productId: string;
  readonly title: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly lineTotal: Money;
}

export interface OrderRecord {
  readonly id: string;
  readonly buyerUserId: string;
  readonly storeId: string;
  readonly status: OrderState;
  readonly total: Money;
  readonly expiresAt: Date;
  readonly paidAt: Date | null;
  readonly createdAt: Date;
  readonly items: readonly OrderItemRecord[];
}

interface OrderRow {
  [key: string]: unknown;
  id: string;
  buyer_user_id: string;
  store_id: string;
  status: string;
  total_minor: string | bigint;
  currency: string;
  expires_at: Date | string;
  paid_at: Date | string | null;
  created_at: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function hydrate(db: Database, row: OrderRow): Promise<OrderRecord> {
  const items = await db.execute<{
    [key: string]: unknown;
    product_id: string;
    title_snapshot: string;
    unit_price_minor: string | bigint;
    currency: string;
    quantity: number;
    line_total_minor: string | bigint;
  }>(sql`
    select product_id, title_snapshot, unit_price_minor, currency, quantity, line_total_minor
      from order_items where order_id = ${row.id}::uuid order by title_snapshot
  `);

  return {
    id: row.id,
    buyerUserId: row.buyer_user_id,
    storeId: row.store_id,
    status: row.status as OrderState,
    total: money(BigInt(row.total_minor), row.currency),
    expiresAt: toDate(row.expires_at),
    paidAt: row.paid_at === null ? null : toDate(row.paid_at),
    createdAt: toDate(row.created_at),
    items: items.rows.map((i) => ({
      productId: i.product_id,
      title: i.title_snapshot,
      unitPrice: money(BigInt(i.unit_price_minor), i.currency),
      quantity: Number(i.quantity),
      lineTotal: money(BigInt(i.line_total_minor), i.currency),
    })),
  };
}

export interface CheckoutInput {
  readonly storeSlug: string;
  readonly productSlug: string;
  /**
   * The buyer's idempotency key. Supplied by the client and scoped to the
   * buyer, so one person's key cannot collide with another's, and a repeated
   * submission of the same intent returns the same order.
   */
  readonly checkoutKey: string;
  readonly quantity?: number;
}

export interface CheckoutResult {
  readonly order: OrderRecord;
  /** True when an existing order was returned rather than a new one created. */
  readonly replayed: boolean;
}

/**
 * Creates — or re-returns — the order for a buyer's intent to purchase.
 *
 * The order of the checks is the design:
 *
 *   1. `authorize()` — may this actor create an order at all;
 *   2. `requireAccountConsent()` — a `pending_consent` account resolves to no
 *      actor at all, so this is belt and braces for an account that became
 *      unconsented after signing in;
 *   3. the product is read with the PUBLIC visibility rules in the WHERE
 *      clause, so a draft or suspended-store product is never fetched and then
 *      rejected — it simply does not exist for this query;
 *   4. the price is read from that row and the total computed here.
 *
 * Nothing between 3 and 4 can be influenced by the caller.
 */
export async function createCheckout(
  db: Database,
  actor: Actor,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  await authorize(db, actor, "order.create");
  await requireAccountConsent(db, actor.userId);

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ProductNotPurchasableError("A quantity must be a whole number of at least one.");
  }
  if (input.checkoutKey.trim() === "" || input.checkoutKey.length > 128) {
    throw new ProductNotPurchasableError("A checkout key is required.");
  }

  /*
   * The visibility rules are in the WHERE clause, not applied afterwards.
   *
   * `status = 'published'` on both the product and its store is the same
   * condition `findPublicProduct` uses. A buyer therefore cannot check out
   * something they could not have seen, and an unpublished product is not
   * "found then refused" — it is not found.
   */
  const found = await db.execute<{
    [key: string]: unknown;
    product_id: string;
    store_id: string;
    owner_user_id: string;
    title: string;
    price_minor: string | bigint;
    currency: string;
  }>(sql`
    select p.id as product_id, p.store_id, s.owner_user_id, p.title, p.price_minor, p.currency
      from products p
      join stores s on s.id = p.store_id
     where s.slug = ${input.storeSlug}
       and p.slug = ${input.productSlug}
       and p.status = 'published'
       and s.status = 'published'
  `);
  const product = found.rows[0];
  if (product === undefined) {
    throw new ProductNotPurchasableError("That product is not available for purchase.");
  }

  /*
   * A seller may not buy their own product.
   *
   * Not a moral position: the sale would credit and debit the same person
   * through a commission split, which is a meaningless ledger entry and an
   * obvious way to manufacture volume.
   */
  if (product.owner_user_id === actor.userId) {
    throw new ProductNotPurchasableError("You cannot buy a product from your own store.");
  }

  const owned = await db.execute<{ id: string }>(sql`
    select id from entitlements
     where user_id = ${actor.userId}::uuid and product_id = ${product.product_id}::uuid
  `);
  if (owned.rows.length > 0) throw new AlreadyOwnedError();

  const unitPriceMinor = BigInt(product.price_minor);
  const lineTotalMinor = unitPriceMinor * BigInt(quantity);
  const ttlSeconds = await loadCheckoutTtlSeconds(db);

  const orderId = uuidv7();
  await db.transaction(async (tx) => {
    /*
     * `on conflict do nothing` on (buyer, checkout_key), then read back.
     *
     * The alternative — select, then insert if absent — is a race two taps can
     * lose: both read nothing and both insert. Letting the unique index arbitrate
     * means the second one writes nothing and finds the first one's row.
     */
    await tx.execute(sql`
      insert into orders (id, buyer_user_id, store_id, checkout_key, status,
                          total_minor, currency, expires_at)
      values (${orderId}, ${actor.userId}, ${product.store_id}, ${input.checkoutKey},
              'pending_payment', ${lineTotalMinor.toString()}, ${product.currency},
              now() + make_interval(secs => ${ttlSeconds}))
      on conflict (buyer_user_id, checkout_key) do nothing
    `);
    await tx.execute(sql`
      insert into order_items (id, order_id, product_id, store_id, title_snapshot,
                               unit_price_minor, currency, quantity, line_total_minor)
      select ${uuidv7()}, ${orderId}, ${product.product_id}, ${product.store_id},
             ${product.title}, ${unitPriceMinor.toString()}, ${product.currency},
             ${quantity}, ${lineTotalMinor.toString()}
       where exists (select 1 from orders where id = ${orderId}::uuid)
      on conflict (order_id, product_id) do nothing
    `);
  });

  const stored = await db.execute<OrderRow>(sql`
    select id, buyer_user_id, store_id, status, total_minor, currency,
           expires_at, paid_at, created_at
      from orders
     where buyer_user_id = ${actor.userId}::uuid and checkout_key = ${input.checkoutKey}
  `);
  const row = stored.rows[0];
  if (row === undefined) throw new OrderNotFoundError(input.checkoutKey);

  const replayed = row.id !== orderId;
  const order = await hydrate(db, row);

  /*
   * A replay must be a replay of the SAME intent.
   *
   * Reusing one key for a different product would otherwise return the first
   * order and silently drop the second purchase — the buyer would see a
   * confirmation for something they did not ask for.
   */
  if (replayed && !order.items.some((i) => i.productId === product.product_id)) {
    throw new CheckoutConflictError();
  }

  if (!replayed) {
    await audit(db, {
      actorKind: "user",
      actorUserId: actor.userId,
      action: "order.created",
      targetType: "order",
      targetId: order.id,
      context: {
        storeId: product.store_id,
        productId: product.product_id,
        totalMinor: lineTotalMinor.toString(),
        currency: product.currency,
      },
    });
  }

  return { order, replayed };
}

/** One order, scoped to its buyer in SQL rather than checked after reading. */
export async function findOwnOrder(
  db: Database,
  actor: Actor,
  orderId: string,
): Promise<OrderRecord> {
  await authorize(db, actor, "order.read_own");
  const rows = await db.execute<OrderRow>(sql`
    select id, buyer_user_id, store_id, status, total_minor, currency,
           expires_at, paid_at, created_at
      from orders where id = ${orderId}::uuid and buyer_user_id = ${actor.userId}::uuid
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new OrderNotFoundError(orderId);
  return hydrate(db, row);
}

export async function listOwnOrders(db: Database, actor: Actor): Promise<OrderRecord[]> {
  await authorize(db, actor, "order.read_own");
  const rows = await db.execute<OrderRow>(sql`
    select id, buyer_user_id, store_id, status, total_minor, currency,
           expires_at, paid_at, created_at
      from orders where buyer_user_id = ${actor.userId}::uuid
     order by created_at desc limit 100
  `);
  return Promise.all(rows.rows.map((r) => hydrate(db, r)));
}

/** What the buyer owns. Read from entitlements, never inferred from an order. */
export async function listOwnEntitlements(
  db: Database,
  actor: Actor,
): Promise<ReadonlyArray<{ productId: string; title: string; storeSlug: string; productSlug: string; grantedAt: Date }>> {
  await authorize(db, actor, "order.read_own");
  const rows = await db.execute<{
    [key: string]: unknown;
    product_id: string;
    title: string;
    store_slug: string;
    product_slug: string;
    granted_at: Date | string;
  }>(sql`
    select e.product_id, p.title, s.slug as store_slug, p.slug as product_slug, e.granted_at
      from entitlements e
      join products p on p.id = e.product_id
      join stores s on s.id = p.store_id
     where e.user_id = ${actor.userId}::uuid
     order by e.granted_at desc
  `);
  return rows.rows.map((r) => ({
    productId: r.product_id,
    title: r.title,
    storeSlug: r.store_slug,
    productSlug: r.product_slug,
    grantedAt: toDate(r.granted_at),
  }));
}
