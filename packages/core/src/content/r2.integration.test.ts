import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { S3ContentStorage } from "./s3";
import { selectContentStorage } from "./select";
import { probeAnonymousAccess, anonymousUrls, verifyObjectStorage } from "./verify";

/**
 * The real bucket, when there is one.
 *
 * Every other test in this directory runs against a deterministic double: the
 * in-memory adapter, or an HTTP server that recomputes SigV4 and refuses a
 * mismatch. Those prove the adapter forms correct requests. They cannot prove
 * that Cloudflare accepts them, and nothing here pretends otherwise.
 *
 * This file closes that last gap and is SKIPPED unless the environment already
 * holds a complete `CONTENT_S3_*` configuration. That is deliberate:
 *
 *   - CI never sets it, so CI never needs a credential and cannot leak one.
 *   - It writes to a real bucket and costs real requests, so it runs when
 *     somebody means it.
 *   - A skipped test is visible in the run's own output, so "we have not tested
 *     the real bucket yet" is a fact the test report states rather than one a
 *     reader has to infer.
 *
 * Run it with the preview bucket's values in the environment:
 *
 *     pnpm --filter @afrinext/core exec vitest run src/content/r2.integration.test.ts
 *
 * It writes only objects under `probe/`, and deletes them.
 */
const REQUIRED = [
  "CONTENT_S3_ENDPOINT", "CONTENT_S3_REGION", "CONTENT_S3_BUCKET",
  "CONTENT_S3_ACCESS_KEY_ID", "CONTENT_S3_SECRET_ACCESS_KEY",
] as const;

const env = process.env;
const configured =
  env["CONTENT_STORAGE"] === "s3" &&
  REQUIRED.every((name) => (env[name] ?? "") !== "");

describe.skipIf(!configured)("the real object store", () => {
  it("passes every check the pre-deploy verification makes", async () => {
    const result = await verifyObjectStorage(env);
    for (const check of result.checks) {
      expect(check.ok, `${check.label} — ${check.detail ?? ""}`).toBe(true);
    }
    expect(result.ok).toBe(true);
  });

  it("round-trips bytes and a content type, then deletes", async () => {
    const storage = selectContentStorage(env);
    expect(storage).toBeInstanceOf(S3ContentStorage);

    const key = `probe/${randomUUID()}/${randomUUID()}`;
    const bytes = Buffer.from(`%PDF-1.7\nafrinext ${new Date().toISOString()}\n%%EOF\n`, "utf8");

    await storage.put(key, bytes, "application/pdf");
    const opened = await storage.open(key);
    expect(opened.bytes.equals(bytes), "byte-for-byte").toBe(true);
    expect(opened.contentType).toContain("application/pdf");

    await storage.remove(key);
    await expect(storage.open(key), "gone after removal").rejects.toThrow();
    // Removing something absent is success, not an error: it is already in the
    // state the caller asked for.
    await expect(storage.remove(key)).resolves.toBeUndefined();
  });

  it("does not serve the object to an unauthenticated request", async () => {
    const storage = selectContentStorage(env);
    const key = `probe/${randomUUID()}/${randomUUID()}`;
    await storage.put(key, Buffer.from("private"), "application/octet-stream");
    try {
      const probe = await probeAnonymousAccess(anonymousUrls(env, key).object);
      expect(probe.ok, `${probe.detail ?? ""}`).toBe(true);
    } finally {
      await storage.remove(key);
    }
  });

  it("refuses a wrong secret, so the refusal above is the bucket's doing", async () => {
    const wrong = new S3ContentStorage({
      endpoint: env["CONTENT_S3_ENDPOINT"] ?? "",
      region: env["CONTENT_S3_REGION"] ?? "auto",
      bucket: env["CONTENT_S3_BUCKET"] ?? "",
      accessKeyId: env["CONTENT_S3_ACCESS_KEY_ID"] ?? "",
      secretAccessKey: "not-the-secret-key",
      forcePathStyle: env["CONTENT_S3_FORCE_PATH_STYLE"] === "yes",
    });
    await expect(wrong.open(`probe/${randomUUID()}`)).rejects.toThrow();
  });
});

/**
 * Runs always, and exists so the file is never silently empty.
 *
 * A test file that skips its whole contents looks identical to one that has
 * been deleted. This one states which of the two it is.
 */
describe("real-bucket coverage", () => {
  it(configured ? "is enabled by the environment" : "is skipped: no bucket configured", () => {
    expect(typeof configured).toBe("boolean");
  });
});
