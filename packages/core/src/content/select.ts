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
