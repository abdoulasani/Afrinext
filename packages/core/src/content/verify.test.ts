import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startS3TestServer, type S3TestServer } from "../test/s3-server";
import { anonymousUrls, safeOrigin, verifyObjectStorage } from "./verify";

/**
 * The pre-deploy bucket check, checked.
 *
 * The reason this test exists is narrow and important: the public-access probe
 * is the single assertion standing between "somebody clicked the wrong toggle
 * in Cloudflare" and a marketplace serving every seller's paid file to anyone
 * who can guess a URL. A probe that has never been pointed at a genuinely
 * public bucket is a probe nobody has seen work.
 *
 * So it runs twice: against a bucket that verifies signatures, and against one
 * deliberately serving unsigned reads.
 */
let priv: S3TestServer;
let pub: S3TestServer;

const envFor = (s: S3TestServer): Record<string, string> => ({
  CONTENT_STORAGE: "s3",
  CONTENT_S3_ENDPOINT: s.endpoint,
  CONTENT_S3_REGION: "auto",
  CONTENT_S3_BUCKET: s.bucket,
  CONTENT_S3_ACCESS_KEY_ID: s.accessKeyId,
  CONTENT_S3_SECRET_ACCESS_KEY: s.secretAccessKey,
  CONTENT_S3_FORCE_PATH_STYLE: "yes",
});

beforeAll(async () => {
  priv = await startS3TestServer();
  pub = await startS3TestServer({ publicReads: true });
});
afterAll(async () => { await priv.close(); await pub.close(); });

describe("verifying a real bucket", () => {
  it("passes every check against a correctly configured private bucket", async () => {
    const result = await verifyObjectStorage(envFor(priv));
    for (const check of result.checks) {
      expect(check.ok, `"${check.label}" — ${check.detail ?? ""}`).toBe(true);
    }
    expect(result.ok).toBe(true);
  });

  it("leaves nothing behind", async () => {
    const before = priv.objects.size;
    const result = await verifyObjectStorage(envFor(priv));
    expect(result.ok).toBe(true);
    expect(priv.objects.size, "the probe object was cleaned up").toBe(before);
  });

  // The one that matters. A bucket somebody flipped public still writes, still
  // reads, still round-trips — every other check passes. Only this one fails.
  it("FAILS against a bucket that serves reads without a signature", async () => {
    const result = await verifyObjectStorage(envFor(pub));
    expect(result.ok, "a public bucket must not be reported as fine").toBe(false);

    const publicCheck = result.checks.find((c) => c.label.includes("refused without a signature"));
    expect(publicCheck?.ok).toBe(false);
    expect(publicCheck?.detail).toContain("THE BUCKET IS PUBLIC");

    // And the round-trip checks still passed, which is exactly why a round-trip
    // test alone would have shipped this bucket.
    expect(result.checks.find((c) => c.label.startsWith("wrote an object"))?.ok).toBe(true);
    expect(result.checks.find((c) => c.label === "checksums agree")?.ok).toBe(true);
  });

  it("reports an unreachable bucket as a failure, never as a pass", async () => {
    // "Refused" and "could not connect" are different facts. Treating a
    // connection error as proof of privacy would pass every misconfiguration.
    const result = await verifyObjectStorage({
      ...envFor(priv),
      CONTENT_S3_ENDPOINT: "http://127.0.0.1:1",
    });
    expect(result.ok).toBe(false);
  });
});

describe("what the check is allowed to print", () => {
  it("reduces the endpoint to an origin, carrying no credentials", () => {
    expect(safeOrigin("https://k:s@acct.r2.cloudflarestorage.com/x?token=abc"))
      .toBe("https://acct.r2.cloudflarestorage.com");
    expect(safeOrigin("nonsense")).toBe("<unparseable>");
  });

  it("names the URL an unauthenticated client would actually try", () => {
    const env = { CONTENT_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
                  CONTENT_S3_BUCKET: "b", CONTENT_S3_FORCE_PATH_STYLE: "yes" };
    expect(anonymousUrls(env, "products/p/v/a").object)
      .toBe("https://acct.r2.cloudflarestorage.com/b/products/p/v/a");
    const virtual = anonymousUrls({ ...env, CONTENT_S3_FORCE_PATH_STYLE: "no" }, "products/p/v/a");
    expect(virtual.object).toBe("https://b.acct.r2.cloudflarestorage.com/products/p/v/a");
  });

  it("never puts the secret key in a result", async () => {
    const result = await verifyObjectStorage(envFor(priv));
    const printed = JSON.stringify(result);
    expect(printed).not.toContain(priv.secretAccessKey);
    expect(printed).not.toContain(priv.accessKeyId);
  });
});
