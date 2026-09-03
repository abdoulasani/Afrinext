import { FilesystemContentStorage, type ContentStorage } from "./storage";
import { S3ContentStorage, StorageNotConfiguredError } from "./s3";

/**
 * Which storage adapter a deployment gets, decided from its environment.
 *
 * This lives in `packages/core` rather than in the Next.js app for one reason:
 * the interesting half of this function is what it REFUSES, and a refusal that
 * nothing tests is a refusal that quietly stops happening. Taking the
 * environment as an argument instead of reading `process.env` makes every
 * misconfiguration a two-line test rather than a deployment.
 *
 * Two refusals, both fail-closed:
 *
 *   - **`s3` without a complete configuration throws.** Falling back to local
 *     disk would be far worse than an error: the storefront would appear to
 *     work, uploads would land on whichever instance answered, and the failure
 *     would surface days later as a buyer's download breaking on one machine
 *     out of two. `S3ContentStorage` validates its whole configuration in its
 *     constructor, so the throw happens at startup and not at first download.
 *   - **`filesystem` under a production build throws** unless the deployment
 *     says `ALLOW_LOCAL_CONTENT_STORAGE=yes`. Local disk is correct for one
 *     server and wrong for two, and a deployment cannot be assumed to know
 *     which it is — so it takes a second, deliberate sentence, exactly as the
 *     mock payment provider and the console sender do.
 *
 * An unknown adapter name throws too. Defaulting a typo to the filesystem is
 * the same silent-fallback bug wearing a different hat.
 */
export interface StorageEnv {
  readonly [key: string]: string | undefined;
}

export function selectContentStorage(env: StorageEnv): ContentStorage {
  const selected = env["CONTENT_STORAGE"] ?? "filesystem";

  if (selected === "s3") {
    assertCredentialsCannotTravelInClear(env["CONTENT_S3_ENDPOINT"] ?? "");
    return new S3ContentStorage({
      endpoint: env["CONTENT_S3_ENDPOINT"] ?? "",
      region: env["CONTENT_S3_REGION"] ?? "",
      bucket: env["CONTENT_S3_BUCKET"] ?? "",
      accessKeyId: env["CONTENT_S3_ACCESS_KEY_ID"] ?? "",
      secretAccessKey: env["CONTENT_S3_SECRET_ACCESS_KEY"] ?? "",
      // MinIO and most S3-compatible providers need path style; AWS prefers
      // virtual-host. Guessing produces a 404 that reads as a missing object.
      forcePathStyle: env["CONTENT_S3_FORCE_PATH_STYLE"] === "yes",
    });
  }

  if (selected !== "filesystem") {
    throw new StorageNotConfiguredError(
      `CONTENT_STORAGE="${selected}" names no adapter; "filesystem" and "s3" are the two`,
    );
  }

  if (env["NODE_ENV"] === "production" && env["ALLOW_LOCAL_CONTENT_STORAGE"] !== "yes") {
    throw new StorageNotConfiguredError(
      "ALLOW_LOCAL_CONTENT_STORAGE, which a production build needs before it will " +
        "keep uploaded files on one machine's disk",
    );
  }

  return new FilesystemContentStorage(env["CONTENT_STORAGE_DIR"] ?? ".content-storage");
}

/**
 * A plaintext endpoint would put the signing credentials on the wire.
 *
 * SigV4 authenticates a request; it does not encrypt it. Over `http://` the
 * `Authorization` header — and the object's bytes — cross the network readable
 * by anything between here and the provider. A typo that drops the `s` is not
 * an error the adapter would otherwise notice: it would work.
 *
 * Loopback is the exception, and only loopback. The browser suite runs its
 * bucket fixture on 127.0.0.1, where there is no network to listen to, and
 * requiring a certificate there would mean either a test-only bypass in this
 * function or a self-signed certificate in the repository. Neither is worth it.
 * A hostname is NOT accepted for this — "localhost" can be pointed anywhere by
 * a hosts file, so the check is on the literal loopback addresses.
 */
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "::1"]);

export function assertCredentialsCannotTravelInClear(endpoint: string): void {
  // An unparseable endpoint is left to S3ContentStorage's own validation, which
  // reports the missing or malformed variable by name.
  let url: URL;
  try { url = new URL(endpoint); } catch { return; }

  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return;

  throw new StorageNotConfiguredError(
    `CONTENT_S3_ENDPOINT uses ${url.protocol}//, which would send the signing ` +
      "credentials and the seller's files across the network in the clear. Use " +
      "https (loopback is the only exception, for the test fixture)",
  );
}
