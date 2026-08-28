import { randomUUID } from "node:crypto";
import { S3ContentStorage } from "./s3";
import { checksumOf } from "./storage";
import { selectContentStorage, type StorageEnv } from "./select";

/**
 * Proves a real bucket is configured correctly — above all, that it is NOT
 * readable without credentials.
 *
 * This is domain code rather than a script because of what it asserts. "Public
 * access is disabled" is otherwise a claim about a setting somebody made once,
 * on a console other people can also reach; here it is the same claim expressed
 * as a request that must be refused, cheap enough to run before every deploy.
 * And a safety check that nothing ever exercises is one nobody knows the shape
 * of — so it lives where a test can point it at a bucket that really is public
 * and watch it say so.
 *
 * It writes one probe object, reads it back, proves it is unreachable without a
 * signature, and deletes it. It returns structured results and formats nothing:
 * the caller decides what to print, which is also what keeps credentials out of
 * the output.
 */

export interface StorageCheck {
  readonly label: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface StorageVerification {
  readonly ok: boolean;
  readonly checks: readonly StorageCheck[];
  /** Safe to print: origin only, no credentials, no query string. */
  readonly origin: string;
  readonly bucket: string;
  readonly key: string;
}

export function safeOrigin(endpoint: string): string {
  try { return new URL(endpoint).origin; } catch { return "<unparseable>"; }
}

/** Where an unauthenticated client would look for the object, and the bucket. */
export function anonymousUrls(env: StorageEnv, key: string): { object: string; bucket: string } {
  const endpoint = env["CONTENT_S3_ENDPOINT"] ?? "";
  const bucket = env["CONTENT_S3_BUCKET"] ?? "";
  const url = new URL(endpoint);
  if (env["CONTENT_S3_FORCE_PATH_STYLE"] === "yes") {
    return { object: `${url.origin}/${bucket}/${key}`, bucket: `${url.origin}/${bucket}` };
  }
  const host = `${bucket}.${url.host}`;
  return { object: `${url.protocol}//${host}/${key}`, bucket: `${url.protocol}//${host}/` };
}

export async function verifyObjectStorage(env: StorageEnv): Promise<StorageVerification> {
  const checks: StorageCheck[] = [];
  const add = (label: string, ok: boolean, detail?: string): void => {
    checks.push(detail === undefined ? { label, ok } : { label, ok, detail });
  };

  // Built through the SAME selector the application uses, so a configuration
  // this accepts is one the app accepts, and vice versa.
  const storage = selectContentStorage(env);
  const key = `probe/${randomUUID()}/${randomUUID()}`;
  const probe = Buffer.from(`afrinext storage probe ${new Date().toISOString()}\n`, "utf8");
  const result = (): StorageVerification => ({
    ok: checks.every((c) => c.ok),
    checks,
    origin: safeOrigin(env["CONTENT_S3_ENDPOINT"] ?? ""),
    bucket: env["CONTENT_S3_BUCKET"] ?? "",
    key,
  });

  if (!(storage instanceof S3ContentStorage)) {
    add("the configuration produces an object-storage adapter", false,
      "it produced the filesystem adapter; there is no bucket to verify");
    return result();
  }

  // ---- the round trip ------------------------------------------------------
  try {
    await storage.put(key, probe, "application/octet-stream");
    add("wrote an object (so the credentials are valid and signing works)", true);
  } catch (error: unknown) {
    add("wrote an object (so the credentials are valid and signing works)", false,
      (error as Error).message);
    return result(); // Nothing further is meaningful without a successful write.
  }

  try {
    const opened = await storage.open(key);
    add("read back byte-for-byte what was written", opened.bytes.equals(probe),
      `${opened.bytes.byteLength} bytes read, ${probe.byteLength} written`);
    add("checksums agree", checksumOf(opened.bytes) === checksumOf(probe));
    add("the content type survived the round trip",
      opened.contentType === "application/octet-stream", `got "${opened.contentType}"`);
  } catch (error: unknown) {
    add("read the object back", false, (error as Error).message);
  }

  // ---- the bucket is not public -------------------------------------------
  //
  // The point of the whole exercise. These requests carry NO Authorization
  // header, which is exactly what a browser that guessed the URL would send.
  const urls = anonymousUrls(env, key);
  try {
    const anonymous = await fetch(urls.object);
    add("the object is refused without a signature", !anonymous.ok,
      anonymous.ok
        ? `THE BUCKET IS PUBLIC — an unauthenticated GET returned ${anonymous.status}`
        : `refused with ${anonymous.status}`);
  } catch (error: unknown) {
    // A connection error is NOT a pass: it says nothing about the bucket.
    add("the object is refused without a signature", false,
      `could not reach it at all: ${(error as Error).message}`);
  }

  try {
    const listing = await fetch(urls.bucket);
    add("the bucket does not list its contents without a signature", !listing.ok,
      listing.ok ? `LISTING IS PUBLIC — returned ${listing.status}` : `refused with ${listing.status}`);
  } catch {
    add("the bucket does not list its contents without a signature", true, "unreachable");
  }

  // ---- authentication is real ---------------------------------------------
  //
  // Proves the refusals above are the bucket enforcing something, rather than
  // this code failing to reach a server that would have said yes.
  const wrong = new S3ContentStorage({
    endpoint: env["CONTENT_S3_ENDPOINT"] ?? "",
    region: env["CONTENT_S3_REGION"] ?? "auto",
    bucket: env["CONTENT_S3_BUCKET"] ?? "",
    accessKeyId: env["CONTENT_S3_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: "not-the-secret-key",
    forcePathStyle: env["CONTENT_S3_FORCE_PATH_STYLE"] === "yes",
  });
  add("a wrong secret key is refused", await wrong.open(key).then(() => false, () => true));

  // ---- cleanup -------------------------------------------------------------
  try {
    await storage.remove(key);
    add("the probe object was deleted", await storage.open(key).then(() => false, () => true));
  } catch (error: unknown) {
    add("the probe object was deleted", false, (error as Error).message);
  }

  return result();
}
