import { betterAuth } from "better-auth";
import { emailOTP, phoneNumber } from "better-auth/plugins";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { uuidv7 } from "../ids";
import { logger } from "../observability";
import { consumeAll, otpSendRules, OTP_POLICY } from "../ratelimit";
import { RateLimitedError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import type { MessageSender } from "./messaging";

/**
 * Better Auth, configured for Afrinext.
 *
 * Better Auth owns AUTHENTICATION: credentials, sign-in, sessions. It is never
 * given any say over AUTHORIZATION — that stays entirely in packages/core/authz,
 * keyed on Afrinext's own `users` row and its scoped role assignments. A session
 * proves who someone is; it never implies what they may do.
 *
 * It reaches PostgreSQL through the pg Pool directly rather than through its
 * Drizzle adapter, because that adapter requires drizzle-orm >= 0.45.2 and the
 * review confirmed Drizzle 0.38.4. The four tables it uses are declared in our
 * own schema and migrations, so they are reviewed and rebuilt from zero in CI
 * like everything else.
 *
 * This module imports no framework. Next.js mounts the returned handler in
 * apps/web; nothing here knows that.
 */
export interface AuthDeps {
  readonly pool: Pool;
  readonly db: Database;
  readonly sender: MessageSender;
  readonly baseUrl: string;
  readonly secret: string;
  /** Supplied per request by the HTTP layer, for per-IP limits. */
  readonly ipAddressForRequest?: () => string | undefined;
}

export type AfrinextAuth = ReturnType<typeof createAuth>;

/** Session lifetimes. Shorter than the industry default: this session moves money. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export function createAuth(deps: AuthDeps) {
  const log = logger.child({ component: "auth" });

  /**
   * Guards every code we send. Better Auth's own attempt limits stop guessing;
   * this stops issuance, which is the part that costs money and the part that
   * makes attempt limits meaningful.
   */
  const guardedSend = async (
    identifier: string,
    code: string,
    channel: "sms" | "email",
  ): Promise<void> => {
    const ip = deps.ipAddressForRequest?.();
    const verdict = await consumeAll(deps.db, otpSendRules(identifier, ip));
    if (!verdict.allowed) {
      log.warn("otp issuance refused", { identifier, channel, used: verdict.used, limit: verdict.limit });
      await audit(deps.db, {
        actorKind: "system",
        action: "auth.otp.rate_limited",
        targetType: "identifier",
        targetId: identifier,
        context: { channel, used: verdict.used, limit: verdict.limit },
      });
      throw new RateLimitedError("verification code", verdict.retryAfterMs);
    }

    if (channel === "sms") {
      await deps.sender.sendSms({ to: identifier, body: `Afrinext: ${code}` });
    } else {
      await deps.sender.sendEmail({
        to: identifier,
        subject: "Afrinext verification code",
        body: `Your Afrinext code is ${code}.`,
      });
    }

    await audit(deps.db, {
      actorKind: "system",
      action: "auth.otp.sent",
      targetType: "identifier",
      targetId: identifier,
      // The code itself is never audited or logged.
      context: { channel, sender: deps.sender.id },
    });
  };

  return betterAuth({
    database: deps.pool,
    baseURL: deps.baseUrl,
    secret: deps.secret,

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: false,
      /**
       * Afrinext's own scrypt, not Better Auth's default hasher.
       *
       * Review decision: keep scrypt for now so no existing hash is
       * invalidated, and keep the encoded parameters in the hash so a later
       * move to Argon2id can verify old hashes while writing new ones.
       * `needsRehash()` is what will drive that migration.
       */
      password: {
        hash: (password: string) => hashPassword(password),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          verifyPassword(password, hash),
      },
    },

    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      additionalFields: {
        // Step-up re-verification for payout-sensitive actions. Set by
        // Afrinext, never by Better Auth; see authz/elevation.
        elevatedAt: { type: "date", required: false, input: false },
      },
    },

    advanced: {
      // Sessions are database rows so revocation is one statement.
      useSecureCookies: process.env["NODE_ENV"] === "production",
      cookiePrefix: "afrinext",
    },

    databaseHooks: {
      user: {
        create: {
          /**
           * Provision the Afrinext domain identity for a new credential.
           *
           * `users` is what role assignments, consent records, audit entries and
           * ledger accounts reference, so it must exist before the person can do
           * anything. The new user is granted the `member` role only — every
           * other capability is an explicit later grant.
           */
          after: async (created: { id: string; email?: string | null; phoneNumber?: string | null }) => {
            const domainUserId = uuidv7();
            await deps.db.execute(sql`
              insert into users (id, display_name, locale, status, auth_user_id)
              values (${domainUserId}, ${created.email ?? created.phoneNumber ?? null}, 'fr', 'active', ${created.id})
              on conflict (auth_user_id) do nothing
            `);
            await deps.db.execute(sql`
              insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
              select ${uuidv7()}, ${domainUserId}, r.id, 'global', null
                from roles r where r.key = 'member'
              on conflict do nothing
            `);
            await audit(deps.db, {
              actorKind: "system",
              action: "auth.user.provisioned",
              targetType: "user",
              targetId: domainUserId,
              context: { authUserId: created.id, grantedRole: "member" },
            });
            log.info("domain user provisioned", { userId: domainUserId });
          },
        },
      },
    },

    plugins: [
      phoneNumber({
        sendOTP: async ({ phoneNumber: to, code }) => {
          await guardedSend(to, code, "sms");
        },
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: OTP_POLICY.verificationAttempts,
        signUpOnVerification: {
          // A phone-first market: most people will never have an email address
          // on file, so one is synthesised and never used for delivery.
          getTempEmail: (phone) => `${phone.replace(/[^0-9]/g, "")}@phone.afrinext.local`,
          getTempName: (phone) => phone,
        },
      }),
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          await guardedSend(email, otp, "email");
        },
        otpLength: 6,
        expiresIn: 5 * 60,
      }),
    ],
  });
}
