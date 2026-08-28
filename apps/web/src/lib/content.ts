import { content } from "@afrinext/core";

/**
 * The runtime pieces the content domain needs: somewhere to put bytes, and the
 * key that signs access grants.
 *
 * Both are cached across hot reloads for the same reason the auth instance is.
 * Neither is a decision the domain makes — `packages/core` knows about a
 * `ContentStorage` interface and a Buffer, and nothing about a directory, a
 * bucket or an environment variable.
 *
 * The choice of adapter, and every refusal around it, lives in
 * `content.selectContentStorage`. This file's whole job is to hand it
 * `process.env` once and cache the answer: a fail-closed rule that only exists
 * inside the Next.js app is a rule no unit test can reach, and the mutation
 * matrix said so out loud.
 */
const globalForContent = globalThis as unknown as {
  afrinextStorage?: content.ContentStorage;
  afrinextContentKey?: Buffer;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
}

export function getContentStorage(): content.ContentStorage {
  globalForContent.afrinextStorage ??= content.selectContentStorage(process.env);
  return globalForContent.afrinextStorage;
}

export function getContentKey(): Buffer {
  globalForContent.afrinextContentKey ??= content.deriveContentKey(requiredEnv("SESSION_SECRET"));
  return globalForContent.afrinextContentKey;
}
