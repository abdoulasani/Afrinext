import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import {
  money as m, orders as ordersDomain, payments as paymentsDomain,
  profile as profileDomain,
} from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { isLocale, translate, type MessageKey } from "@afrinext/i18n";
import AppHeader from "@/components/AppHeader";
import PayButton from "@/components/PayButton";
import ProfileGate from "@/components/ProfileGate";
import { currencyRegistry } from "@/lib/catalog";
import { completeProfileAction } from "@/lib/order-actions";
import { currentActor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * What each channel is called on screen.
 *
 * A `Record` over the allowlist rather than a dynamically built key, so it is
 * EXHAUSTIVE: adding a channel to `PAYMENT_CHANNELS` fails to compile until
 * somebody names it here, in both catalogues. A template-literal key would have
 * compiled fine and shipped a screen showing a raw identifier.
 */
const CHANNEL_LABELS: Record<
  paymentsDomain.PaymentChannel,
  { label: MessageKey; detail: MessageKey }
> = {
  mobile_money: {
    label: "checkout.channelMobileMoney",
    detail: "checkout.channelMobileMoneyDetail",
  },
};

/**
 * One order, for the person who placed it.
 *
 * `findOwnOrder` scopes to the actor in SQL, so another buyer's order id is not
 * "found then refused" — it is not found, and this page renders a 404 for it.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();

  const actor = await currentActor();
  if (actor === undefined) redirect(`/${locale}/sign-in` as Route);

  const order = await ordersDomain.findOwnOrder(getDb(), actor, id).catch(() => undefined);
  if (order === undefined) notFound();

  // The charge attempt, if one has been started. Shown so the buyer can tell
  // "I have not paid yet" from "the provider has not answered yet" — two very
  // different things that looked identical before.
  const payment = await ordersDomain
    .findOrderPayment(getDb(), actor, order.id)
    .catch(() => undefined);

  const registry = await currencyRegistry();
  const statusLabel = translate(locale, `order.status.${order.status}`);

  /*
   * Whether this buyer can pay at all yet.
   *
   * A payment provider asks who is paying, and sign-in only ever proved
   * possession of a phone. When the name or country is missing the pay button
   * is replaced by the form that collects them — not disabled alongside it,
   * because an action a person can see but not use explains nothing.
   *
   * This read is presentation only. `initiatePayment` runs the same check
   * server-side and refuses regardless of what this page rendered.
   */
  const buyerProfile = await profileDomain.loadBuyerProfile(getDb(), actor.userId);
  const profileComplete = profileDomain.isProfileComplete(buyerProfile);
  const countries = profileComplete ? [] : await profileDomain.selectableCountries(getDb());

  return (
    <>
      <AppHeader title={translate(locale, "order.title")} back={`/${locale}/orders` as Route} />
      <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
        <section className="flex flex-col gap-1">
          <p data-testid="order-status" className="text-caption uppercase tracking-wide text-muted">
            {statusLabel}
          </p>
          <p data-testid="order-total" className="text-h1 font-semibold tabular-nums">
            {m.formatMoney(order.total, registry)}
          </p>
        </section>

        <ul className="flex flex-col gap-2">
          {order.items.map((item) => (
            <li
              key={item.productId}
              className="flex items-baseline justify-between gap-3 rounded-[var(--radius-md)] bg-surface-muted px-3 py-2"
            >
              <span className="text-small font-medium">{item.title}</span>
              <span className="text-small tabular-nums text-muted">
                {item.quantity} × {m.formatMoney(item.unitPrice, registry)}
              </span>
            </li>
          ))}
        </ul>

        {payment !== undefined && (
          <p data-testid="payment-status" className="text-caption text-muted">
            {payment.status}
          </p>
        )}

        {order.status === "pending_payment" && (
          <section className="flex flex-col gap-2 border-t border-border pt-5">
            {profileComplete ? (
              <PayButton
                locale={locale}
                orderId={order.id}
                label={translate(locale, "order.pay")}
                waiting={translate(locale, "order.awaiting")}
                /*
                 * Built from the domain allowlist, so the screen can only ever
                 * offer what the server accepts. Adding a channel is one line
                 * in `PAYMENT_CHANNELS` and its provider mapping; there is no
                 * second list here to forget to update.
                 */
                channels={paymentsDomain.PAYMENT_CHANNELS.map((value) => ({
                  value,
                  label: translate(locale, CHANNEL_LABELS[value].label),
                  detail: translate(locale, CHANNEL_LABELS[value].detail),
                }))}
                channelLabels={{
                  heading: translate(locale, "checkout.channelHeading"),
                  onlyOne: translate(locale, "checkout.channelOnlyOne"),
                }}
              />
            ) : (
              <ProfileGate
                locale={locale}
                countries={countries}
                action={completeProfileAction}
                labels={{
                  heading: translate(locale, "profile.heading"),
                  explain: translate(locale, "profile.explain"),
                  nameLabel: translate(locale, "profile.nameLabel"),
                  namePlaceholder: translate(locale, "profile.namePlaceholder"),
                  countryLabel: translate(locale, "profile.countryLabel"),
                  countryPlaceholder: translate(locale, "profile.countryPlaceholder"),
                  save: translate(locale, "profile.save"),
                  privacy: translate(locale, "profile.privacy"),
                }}
              />
            )}
          </section>
        )}

        {order.status === "refund_due" && (
          <section className="flex flex-col gap-2 border-t border-border pt-5">
            {/*
              * Said plainly, and NOT as a completed refund.
              *
              * The money reached the provider and Afrinext did not deliver. The
              * order is queued for a refund that has not been executed — saying
              * anything warmer than that would be telling the buyer their money
              * is on its way when no code sends it.
              */}
            <p data-testid="order-refund-due" className="text-small font-medium">
              {translate(locale, "order.refundDueExplain")}
            </p>
            <p className="text-caption text-muted">
              {translate(locale, "order.refundNotYetExecuted")}
            </p>
          </section>
        )}

        {order.status === "paid" && (
          <section className="flex flex-col gap-2 border-t border-border pt-5">
            <p data-testid="order-paid" className="text-small font-medium">
              {translate(locale, "order.paidExplain")}
            </p>
            {/*
              * Said plainly on the screen, because it is true: the provider has
              * confirmed, and the seller has not been settled. No screen in
              * Afrinext describes an entitlement as money held for someone.
              */}
            <p className="text-caption text-muted">{translate(locale, "order.notSettled")}</p>
            <a
              href={`/${locale}/orders`}
              className="w-full rounded-[var(--radius-md)] bg-primary px-4 py-3 text-center text-small font-semibold text-primary-contrast"
            >
              {translate(locale, "order.openLibrary")}
            </a>
          </section>
        )}
      </div>
    </>
  );
}
