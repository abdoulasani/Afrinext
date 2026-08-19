import { auth as core } from "@afrinext/core";
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
  });
  return globalForAuth.afrinextAuth;
}
