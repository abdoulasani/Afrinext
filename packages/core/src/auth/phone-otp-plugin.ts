import { sql } from "drizzle-orm";
import { z } from "zod";
import type { BetterAuthPlugin, User } from "better-auth";
import { APIError, createAuthEndpoint, getIP } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { logger } from "../observability";
import { consumeAll, otpSendRules, type OtpPolicy } from "../ratelimit";
import { RateLimitedError } from "./errors";
import type { MessageSender } from "./messaging";
import { issueChallenge, consumeChallenge } from "./otp-store";
import type { OtpTiming } from "./otp";

/** The row Better Auth owns: the credential, not the Afrinext identity. */
type AuthUser = User & { readonly phoneNumber?: string | null };

/**
 * Phone sign-in, with the code held in `otp_challenges` and never in Better
 * Auth's `verification` table.
 *
 * Better Auth's own phone plugin is deliberately NOT installed. It writes the
 * code to `verification.value` as `<code>:<attempts>` in the clear before it
 * calls the sender, and offers no hook to change that — so merely declining to
 * call its send route would leave a reachable endpoint that mints plaintext
 * codes on demand. Removing the plugin removes the endpoint.
 *
 * What Better Auth still does, and should: create the credential row and mint
 * and manage the session. It remains the only session store, and it still has
 * no say in authorization — the session this returns proves identity and grants
 * nothing until `authorize()` says otherwise.
 */
export interface PhoneOtpOptions {
  readonly db: Database;
  readonly sender: MessageSender;
  /** Derived from the application secret; see `deriveOtpKey`. */
  readonly key: Buffer;
  readonly policy: OtpPolicy;
  readonly timing: OtpTiming;
  /** Synthesised for phone-first accounts; never used for delivery. */
  readonly tempEmail: (phone: string) => string;
}

const PHONE = z.object({
  phoneNumber: z.string().min(4).max(20),
});

const PHONE_AND_CODE = z.object({
  phoneNumber: z.string().min(4).max(20),
  code: z.string().min(4).max(10),
});

/**
 * One message for every way a code can fail to verify.
 *
 * "No such challenge", "wrong code" and "expired" are all answered identically
 * so the endpoint cannot be used to learn which phone numbers have an account
 * or a code in flight. The real reason is audited, where only we can read it.
 */
function invalidCode(): APIError {
  return new APIError("BAD_REQUEST", {
    code: "auth.otp_invalid",
    message: "That code is not valid. Request a new one.",
  });
}

export function phoneOtp(opts: PhoneOtpOptions) {
  const log = logger.child({ component: "auth.phone-otp" });

  return {
    id: "afrinext-phone-otp",

    schema: {
      user: {
        fields: {
          phoneNumber: { type: "string" as const, required: false, unique: true, returned: true },
          phoneNumberVerified: {
            type: "boolean" as const, required: false, returned: true, input: false,
          },
        },
      },
    },

    // Better Auth's own limiter, as a coarse backstop in front of ours. Ours is
    // the one that counts in PostgreSQL and survives more than one instance.
    rateLimit: [{ pathMatcher: (p: string) => p.startsWith("/phone-otp"), window: 60, max: 10 }],

    endpoints: {
      sendPhoneOtp: createAuthEndpoint(
        "/phone-otp/send",
        { method: "POST", body: PHONE },
        async (ctx) => {
          const phone = ctx.body.phoneNumber;
          const source = ctx.request ?? ctx.headers;
          const ip = source === undefined ? undefined : (getIP(source, ctx.context.options) ?? undefined);

          const verdict = await consumeAll(opts.db, otpSendRules(phone, ip, opts.policy));
          if (!verdict.allowed) {
            log.warn("otp issuance refused", { identifier: phone, used: verdict.used, limit: verdict.limit });
            await audit(opts.db, {
              actorKind: "system",
              action: "auth.otp.rate_limited",
              targetType: "identifier",
              targetId: phone,
              context: { channel: "sms", used: verdict.used, limit: verdict.limit },
            });
            const refusal = new RateLimitedError("verification code", verdict.retryAfterMs);
            throw new APIError(
              "TOO_MANY_REQUESTS",
              { code: refusal.code, message: refusal.message },
              { "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))) },
            );
          }

          const issued = await issueChallenge(opts.db, {
            kind: "phone",
            identifier: phone,
            purpose: "sign_in",
            key: opts.key,
            timing: opts.timing,
            ...(ip !== undefined ? { ipAddress: ip } : {}),
          });

          await opts.sender.sendSms({ to: phone, body: `Afrinext: ${issued.code}` });

          await audit(opts.db, {
            actorKind: "system",
            action: "auth.otp.sent",
            targetType: "identifier",
            targetId: phone,
            // The code itself is never audited and never logged.
            context: { channel: "sms", sender: opts.sender.id, challengeId: issued.challengeId },
          });

          return ctx.json({ status: true, expiresAt: issued.expiresAt.toISOString() });
        },
      ),

      verifyPhoneOtp: createAuthEndpoint(
        "/phone-otp/verify",
        { method: "POST", body: PHONE_AND_CODE },
        async (ctx) => {
          const phone = ctx.body.phoneNumber;

          const result = await consumeChallenge(opts.db, {
            kind: "phone",
            identifier: phone,
            purpose: "sign_in",
            code: ctx.body.code,
            key: opts.key,
          });

          if (!result.ok) {
            await audit(opts.db, {
              actorKind: "system",
              action: "auth.otp.failed",
              targetType: "identifier",
              targetId: phone,
              context: { channel: "sms", reason: result.reason },
            });
            log.warn("otp verification refused", { identifier: phone, reason: result.reason });
            throw invalidCode();
          }

          const existing = await ctx.context.adapter.findOne<AuthUser>({
            model: "user",
            where: [{ field: "phoneNumber", value: phone }],
          });

          // Creating the credential fires the `user.create.after` database hook,
          // which is what provisions the Afrinext identity and grants `member`.
          // Going through Better Auth here rather than inserting the row
          // ourselves is what keeps that one provisioning path.
          const user: AuthUser =
            existing === null
              ? await ctx.context.internalAdapter.createUser(
                  {
                    email: opts.tempEmail(phone),
                    name: phone,
                    phoneNumber: phone,
                    phoneNumberVerified: true,
                  },
                  { method: "phone-otp" },
                )
              : await ctx.context.internalAdapter.updateUser(existing.id, {
                  phoneNumberVerified: true,
                });

          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              code: "auth.session_unavailable",
              message: "The session could not be created. Try again.",
            });
          }
          await setSessionCookie(ctx, { session, user });

          await audit(opts.db, {
            actorKind: "system",
            action: "auth.otp.verified",
            targetType: "identifier",
            targetId: phone,
            context: { challengeId: result.challengeId, authUserId: user.id },
          });

          return ctx.json({ status: true, token: session.token });
        },
      ),
    },
    // `satisfies`, not a return-type annotation: annotating the return as
    // BetterAuthPlugin widens `endpoints` and Better Auth then infers an
    // `auth.api` without sendPhoneOtp or verifyPhoneOtp on it. This checks the
    // shape without erasing it.
  } satisfies BetterAuthPlugin;
}

/**
 * Fails loudly if anything ever writes a phone code into Better Auth's table.
 *
 * The guarantee this phase is built on is that `verification` holds no phone
 * code. That is a property of which plugins are installed, which is exactly the
 * kind of thing a future upgrade changes silently, so it is asserted rather
 * than assumed. Used by the test suite.
 */
export async function assertNoPlaintextPhoneCodes(db: Database, phone: string): Promise<void> {
  const rows = await db.execute<{ identifier: string }>(sql`
    select identifier from verification where identifier = ${phone}
  `);
  if (rows.rows.length > 0) {
    throw new Error(
      `Better Auth stored a verification row for ${phone}. A plaintext phone OTP ` +
        "path has been reintroduced — see review decision 1.",
    );
  }
}
