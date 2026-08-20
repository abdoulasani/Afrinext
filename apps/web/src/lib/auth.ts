import { auth as core, ratelimit } from "@afrinext/core";
import { getDb, getPool } from "@afrinext/db";

/**
 * The server-side Better Auth instance.
 *
 * Configuration lives in packages/core so the domain layer stays framework-free;
 * this module only supplies the runtime pieces Next.js has (the pool, the
 * environment) and caches the instance across hot reloads.
 */
const globalForAuth = globalThis as unknown as { afrinextAuth?: core.AfrinextAuth };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
}

export function getAuth(): core.AfrinextAuth {
  globalForAuth.afrinextAuth ??= core.createAuth({
    pool: getPool(),
    db: getDb(),
    // No SMS or email provider has been chosen for Niger yet. ConsoleSender
    // refuses to run under NODE_ENV=production unless ALLOW_CONSOLE_SENDER is
    // set explicitly, so a missing provider fails loudly rather than silently
    // dropping every verification code in front of real users.
    sender: new core.ConsoleSender(),
    baseUrl: process.env["APP_URL"] ?? "http://localhost:3000",
    secret: requiredEnv("SESSION_SECRET"),
    /**
     * The limits come from `platform_settings`, not from literals.
     *
     * A function, not a value: this instance is built once and cached for the
     * life of the process, so resolving the policy here would pin whatever the
     * table held at boot and turn "change a limit" back into "deploy". The
     * resolver runs on the request that issues a code — one small read next to
     * the counter writes that request already makes.
     *
     * Until this was wired, `loadOtpPolicy` existed and nothing called it: the
     * running app used the compiled-in defaults, so review decision 7 was
     * satisfied in packages/core and not in production. See the milestone note.
     */
    otpPolicy: () => ratelimit.loadOtpPolicy(getDb()),
  });
  return globalForAuth.afrinextAuth;
}
