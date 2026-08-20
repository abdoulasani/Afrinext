import { content } from "@afrinext/core";

/**
 * The runtime pieces the content domain needs: somewhere to put bytes, and the
 * key that signs access grants.
 *
 * Both are cached across hot reloads for the same reason the auth instance is.
 * Neither is a decision the domain makes — `packages/core` knows about a
 * `ContentStorage` interface and a Buffer, and nothing about a directory or an
 * environment variable.
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

/**
 * Local disk, under one directory.
 *
 * Honest about what it is: single-machine storage, fine for development, CI and
 * a single-server deployment, and wrong for two web instances behind a load
 * balancer. No object store is configured for Afrinext and none is pretended
 * here — when one is chosen, it is a second implementation of the port in
 * `packages/core/content/storage.ts` and this function returns that instead.
 */
export function getContentStorage(): content.ContentStorage {
  globalForContent.afrinextStorage ??= new content.FilesystemContentStorage(
    process.env["CONTENT_STORAGE_DIR"] ?? ".content-storage",
  );
  return globalForContent.afrinextStorage;
}

export function getContentKey(): Buffer {
  globalForContent.afrinextContentKey ??= content.deriveContentKey(requiredEnv("SESSION_SECRET"));
  return globalForContent.afrinextContentKey;
}
