import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { audit } from "../audit";
import { uuidv7 } from "../ids";
import { logger } from "../observability";
import {
  consumeAll, otpSendRules, resolveOtpPolicy, OTP_POLICY, type OtpPolicySource,
} from "../ratelimit";
import { RateLimitedError } from "./errors";
import { previewSellersEnabled, PREVIEW_SELLERS_FLAG } from "./preview-sellers";
import { hashPassword, verifyPassword } from "./password";
import type { MessageSender } from "./messaging";
import { deriveOtpKey } from "./otp";
import { phoneOtp } from "./phone-otp-plugin";

/**
 * Better Auth, configured for Afrinext.
 *
 * Better Auth owns AUTHENTICATION: credentials, sign-in, sessions. It is never
 * given any say over AUTHORIZATION — that stays entirely in packages/core/authz,
 * keyed on Afrinext's own `users` row and its scoped role assignments. A session
 * proves who someone is; it never implies what they may do.
 *
 * It reaches PostgreSQL through the pg Pool directly rather than through its
 * Drizzle adapter. The adapter would generate and own its own tables; going
 * through the Pool keeps the four tables it uses declared in our own schema and
 * migrations, so they are reviewed, diffed and rebuilt from zero in CI like
 * everything else. (The version constraint that originally forced this choice
 * is gone — drizzle-orm is now 0.45.2 — but the ownership argument is the
 * reason it stays.)
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
  /**
   * OTP limits. Pass a FUNCTION — normally `() => loadOtpPolicy(db)` — so the
   * limits are read on the request that needs them and an operator can change
   * them with an UPDATE instead of a deploy. A plain object is accepted for
   * tests that want a fixed policy. Omitted means the defaults.
   */
  readonly otpPolicy?: OtpPolicySource | undefined;
}

export type AfrinextAuth = ReturnType<typeof createAuth>;

/** Session lifetimes. Shorter than the industry default: this session moves money. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export function createAuth(deps: AuthDeps) {
  const log = logger.child({ component: "auth" });
  const policy = () => resolveOtpPolicy(deps.otpPolicy);
  const otpKey = deriveOtpKey(deps.secret);

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
    const verdict = await consumeAll(deps.db, otpSendRules(identifier, ip, await policy()));
    if (!verdict.allowed) {
      log.warn("otp issuance refused", { identifier, channel, used: verdict.used, limit: verdict.limit });
      await audit(deps.db, {
        actorKind: "system",
        action: "auth.otp.rate_limited",
        targetType: "identifier",
        targetId: identifier,
        context: { channel, used: verdict.used, limit: verdict.limit },
      });
      /**
       * Better Auth turns an unrecognised throw into a bare 500, which tells the
       * caller nothing and reads as an Afrinext fault in monitoring. A refusal
       * to issue is a client-visible, retryable condition, so it leaves the
       * handler as a real 429 carrying `Retry-After`. The domain error is still
       * constructed, so the wording and the `ratelimit.exceeded` code stay in
       * one place and match what `apps/web/src/lib/api.ts` returns elsewhere.
       */
      const refusal = new RateLimitedError("verification code", verdict.retryAfterMs);
      throw new APIError(
        "TOO_MANY_REQUESTS",
        { code: refusal.code, message: refusal.message },
        { "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))) },
      );
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

    /*
     * Better Auth's own limiter, in front of ours.
     *
     * Two limiters guarding one endpoint must not disagree about the answer.
     * Ours is the authoritative one: it counts in PostgreSQL, so it holds
     * across instances and restarts, it reads the stored policy, and every
     * refusal is audited and answers with `ratelimit.exceeded`. Better Auth's
     * is in memory, per process, and answers in its own shape.
     *
     * So the backstop is derived from the same policy and deliberately set
     * ABOVE it — twice the hourly allowance, inside a single minute. High
     * enough that the refusal a caller actually meets is always the audited
     * one; low enough that a flood from one address is still stopped before it
     * reaches the database.
     *
     * Verify is bounded the same way, and for a reason the browser suite
     * taught me. It first carried a literal — twenty a minute — and that is
     * exactly the defect the send rule was changed to avoid: a fixed per-IP cap
     * that pre-empts the configured policy. It refused a legitimate sign-in
     * once a run made enough of them from one address, which is precisely what
     * carrier NAT in Niamey looks like from the server's side.
     *
     * Attempt counts are still bounded per challenge, in PostgreSQL, by
     * `max_attempts` — that is the control that stops guessing. This rule only
     * bounds flood volume, so it is derived from the same stored policy and
     * sits above it.
     *
     * Note that Better Auth enables this whole layer only under
     * NODE_ENV=production. That is its default, not our choice, and it is why
     * the browser suite now runs the app in production mode — a control that
     * is off locally and on in CI is a control nobody has tested.
     */
    rateLimit: {
      customRules: {
        "/phone-otp/send": async () => ({ window: 60, max: (await policy()).perIpPerHour * 2 }),
        "/phone-otp/verify": async () => ({ window: 60, max: (await policy()).perIpPerHour * 2 }),
        /*
         * The credential endpoints, for the reason the verify rule already
         * records rather than a new one.
         *
         * Better Auth's defaults for these are a small fixed number per IP in a
         * short window — three in ten seconds — and that is precisely the shape
         * the phone rules were changed to avoid: a literal cap that pre-empts
         * the configured policy and refuses legitimate traffic from one
         * address. Carrier NAT in Niamey is many distinct people behind one IP,
         * and a cybercafé signing four people up in a minute is not an attack.
         *
         * So these are derived from the same stored policy and sit above it,
         * as a flood backstop only. Guessing is bounded elsewhere and properly:
         * the password itself is scrypt at N=65536, which makes a fast online
         * guessing loop a CPU bill rather than a threat.
         *
         * The browser suite is what found this. Eight signups from 127.0.0.1
         * met the fixed default partway through, which is the same lesson the
         * per-IP OTP limit taught, arriving in our own tests first.
         */
        "/sign-up/email": async () => ({ window: 60, max: (await policy()).perIpPerHour * 2 }),
        "/sign-in/email": async () => ({ window: 60, max: (await policy()).perIpPerHour * 2 }),
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
            /*
             * `pending_consent`, not `active`.
             *
             * This one word is the whole signup consent gate. `resolveActor`
             * already returns no actor for any status other than 'active' —
             * that is how suspension has always worked — so the account exists,
             * holds its credentials, and can do nothing until the general terms
             * are accepted. Nothing about OTP generation, storage, expiry,
             * attempt bounds or rate limiting is involved, which is why this
             * change cannot weaken any of them.
             */
            await deps.db.execute(sql`
              insert into users (id, display_name, locale, status, auth_user_id)
              values (${domainUserId}, ${created.email ?? created.phoneNumber ?? null}, 'fr', 'pending_consent', ${created.id})
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

            /*
             * PREVIEW ONLY, and additive by construction.
             *
             * Everything above this point is the production path and is not
             * conditional on anything. What follows adds one more role row when
             * the environment has explicitly declared itself a preview, so that
             * a demonstration does not need a hand-written SQL grant per test
             * account. See preview-sellers.ts for why this lives here and not
             * inside `authorize()`, and for exactly what `seller` can do.
             *
             * The grant is a real `role_assignments` row: revocable with the
             * same UPDATE as any other, visible to the same queries, and
             * audited under its own action so a reader can tell a preview grant
             * from an operator's.
             */
            if (previewSellersEnabled()) {
              await deps.db.execute(sql`
                insert into role_assignments (id, user_id, role_id, scope_type, scope_id)
                select ${uuidv7()}, ${domainUserId}, r.id, 'global', null
                  from roles r where r.key = 'seller'
                on conflict do nothing
              `);
              await audit(deps.db, {
                actorKind: "system",
                action: "auth.user.preview_seller_granted",
                targetType: "user",
                targetId: domainUserId,
                context: { authUserId: created.id, grantedRole: "seller", reason: PREVIEW_SELLERS_FLAG },
              });
              // Warn, not info. An operator reading these logs should be able to
              // notice immediately if this is running somewhere it should not.
              log.warn("preview seller role granted automatically", {
                userId: domainUserId,
                flag: PREVIEW_SELLERS_FLAG,
              });
            }
          },
        },
      },
    },

    plugins: [
      /**
       * Phone sign-in, with the code in our own hashed table.
       *
       * Better Auth's `phoneNumber` plugin is deliberately absent: it writes
       * the code to `verification.value` in the clear and exposes no hook to
       * change that, so the only way to close the plaintext path is not to
       * mount it. See `phone-otp-plugin.ts` and review decision 1.
       */
      phoneOtp({
        db: deps.db,
        sender: deps.sender,
        key: otpKey,
        policy,
        // A phone-first market: most people will never have an email address on
        // file, so one is synthesised and never used for delivery.
        tempEmail: (phone) => `${phone.replace(/[^0-9]/g, "")}@phone.afrinext.local`,
      }),
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          await guardedSend(email, otp, "email");
        },
        otpLength: 6,
        // Better Auth's email plugin takes its lifetime as a construction-time
        // number, so this one value is the compiled-in default rather than the
        // stored policy. Email is not the launch path; the phone path — the one
        // that actually issues codes in Niger — reads ttlMs per request.
        expiresIn: Math.floor(OTP_POLICY.ttlMs / 1000),
        // Email is not the launch path, and this plugin does offer the option
        // the phone one does not. Its default is "plain"; leaving that would be
        // the same defect on a quieter road.
        storeOTP: "hashed",
      }),
    ],
  });
}
