import { DomainError } from "../errors";

/**
 * How a buyer pays.
 *
 * Afrinext launches with exactly ONE channel, and this list is that decision
 * written down. It is an allowlist rather than a validation rule: adding a
 * channel means adding a line here and a provider mapping beside it, so a
 * channel nobody decided to support cannot reach a provider by accident.
 *
 * The values are **Afrinext's words, not iPayMoney's**. That separation is the
 * security property, not a stylistic preference: a browser posts
 * `mobile_money`, which is meaningless to iPayMoney, and the adapter is the
 * only place that knows the header value it maps to. There is therefore no
 * request through which somebody could hand the provider a header value of
 * their choosing — not because it is filtered, but because the domain does not
 * speak that vocabulary at all.
 *
 * `mobile_money` is Airtel Money, Zamani Cash and Moov Money — the three
 * operators iPayMoney documents (extract L254, L256–257), and the three that
 * matter in Niger.
 */
export const PAYMENT_CHANNELS = ["mobile_money"] as const;

export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export class UnsupportedPaymentChannelError extends DomainError {
  override readonly name = "UnsupportedPaymentChannelError";
  readonly offered: readonly string[];
  constructor(received: unknown) {
    super(
      "payments.channel_unsupported",
      `"${String(received)}" is not a payment channel Afrinext offers. ` +
        `Supported: ${PAYMENT_CHANNELS.join(", ")}.`,
    );
    this.offered = PAYMENT_CHANNELS;
  }
}

export function isPaymentChannel(value: unknown): value is PaymentChannel {
  return typeof value === "string" && (PAYMENT_CHANNELS as readonly string[]).includes(value);
}

/**
 * Turns whatever arrived into a channel, or refuses.
 *
 * Everything that is not exactly one of the listed values is refused, including
 * the provider's own vocabulary. Somebody who posts `mobile` — iPayMoney's
 * header value, which they could read out of this repository — is refused just
 * as firmly as somebody who posts nonsense, because the header value is not a
 * choice the domain accepts.
 *
 * There is no default. A missing channel is refused rather than assumed: the
 * documentation states no default for `Ipay-Payment-Type`, and choosing one on
 * a buyer's behalf is a decision about their money.
 */
export function parsePaymentChannel(raw: unknown): PaymentChannel {
  if (!isPaymentChannel(raw)) throw new UnsupportedPaymentChannelError(raw);
  return raw;
}

/** The one channel a buyer is offered at launch. Named so callers read intent. */
export const LAUNCH_PAYMENT_CHANNEL: PaymentChannel = "mobile_money";
