import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startS3TestServer, type S3TestServer } from "../test/s3-server";
import {
  ContentUnavailableError, InvalidStorageKeyError, StorageWriteFailedError,
} from "./storage";
import { S3ContentStorage, signV4, StorageNotConfiguredError } from "./s3";

/**
 * The object-storage adapter.
 *
 * Two kinds of assertion, and the split is deliberate.
 *
 * The first is against **AWS's own published Signature Version 4 test
 * vector** — a fixed request with a fixed key, date and expected signature,
 * taken from the specification's worked example. It is the only way to check
 * canonicalisation and key derivation against something other than my own
 * reading of the spec, and a hand-written signer without it is a guess.
 *
 * The rest run against a real HTTP server that recomputes the signature from
 * the request it received and answers 403 on a mismatch, so every one of them
 * is also a signing test. What none of them establishes is that a particular
 * vendor accepts these requests; only a real bucket proves that, and the
 * milestone note says so.
 */

let s3: S3TestServer;
let storage: S3ContentStorage;

beforeAll(async () => {
  s3 = await startS3TestServer();
  storage = new S3ContentStorage({
    endpoint: s3.endpoint, region: "us-east-1", bucket: s3.bucket,
    accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey,
    forcePathStyle: true,
  });
});

afterAll(async () => { await s3.close(); });

// ===========================================================================

describe("the signature is the specification's, not an approximation", () => {
  /*
   * AWS's worked example, "GET Object" from the SigV4 test suite: a request to
   * examplebucket.s3.amazonaws.com for /test.txt on 2013-05-24 with the
   * documented example credentials. The expected signature is published.
   */
  it("reproduces AWS's published test vector exactly", () => {
    const signed = signV4({
      method: "GET",
      path: "/test.txt",
      host: "examplebucket.s3.amazonaws.com",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      amzDate: "20130524T000000Z",
      extraHeaders: { range: "bytes=0-9" },
    });

    expect(signed.headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("changes the signature when anything signed changes", () => {
    const base = {
      method: "GET", path: "/a.txt", host: "b.example.com", region: "eu-west-3",
      accessKeyId: "AKIA", secretAccessKey: "secret",
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      amzDate: "20260101T000000Z",
    };
    // Deliberately NOT `as const`: the point of this test is to substitute a
    // different value for each field, which literal types would reject.
    const of = (o: Partial<typeof base>): string =>
      signV4({ ...base, ...o }).headers["authorization"] as string;

    const original = of({});
    expect(of({ path: "/b.txt" }), "a different object").not.toBe(original);
    expect(of({ method: "PUT" }), "a different verb").not.toBe(original);
    expect(of({ region: "us-east-1" }), "a different region").not.toBe(original);
    expect(of({ amzDate: "20260102T000000Z" }), "a different day").not.toBe(original);
    expect(of({ secretAccessKey: "other" }), "a different key").not.toBe(original);
  });
});

// ===========================================================================

describe("bytes survive a real HTTP round trip", () => {
  it("stores and returns exactly what it was given, with its content type", async () => {
    const bytes = Buffer.from("%PDF-1.7\nle guide\n%%EOF\n", "utf8");
    await storage.put("products/p1/v1/a1", bytes, "application/pdf");

    const opened = await storage.open("products/p1/v1/a1");
    expect(opened.bytes.equals(bytes), "byte-for-byte").toBe(true);
    expect(opened.contentType).toBe("application/pdf");

    // And every request the adapter made was accepted by the signature check.
    expect(s3.seen.every((r) => r.authorized), "no request was refused").toBe(true);
  });

  it("survives bytes that are not text", async () => {
    const binary = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
    await storage.put("products/p1/v1/binary", binary, "application/zip");
    expect((await storage.open("products/p1/v1/binary")).bytes.equals(binary)).toBe(true);
  });

  it("removes an object, and treats a missing one as already removed", async () => {
    await storage.put("products/p1/v1/gone", Buffer.from("x"), "application/pdf");
    await storage.remove("products/p1/v1/gone");
    await expect(storage.open("products/p1/v1/gone")).rejects.toBeInstanceOf(ContentUnavailableError);
    // Idempotent: deleting what is not there is success, not an error.
    await expect(storage.remove("products/p1/v1/gone")).resolves.toBeUndefined();
  });
});

// ===========================================================================

describe("failures are refusals, never silent success", () => {
  it("refuses to read an object that is not there", async () => {
    await expect(storage.open("products/p1/v1/never-written"))
      .rejects.toBeInstanceOf(ContentUnavailableError);
  });

  it("throws when the provider refuses an upload", async () => {
    s3.failNext(500);
    await expect(storage.put("products/p1/v1/fails", Buffer.from("x"), "application/pdf"))
      .rejects.toBeInstanceOf(StorageWriteFailedError);
    // Nothing was stored, so nothing can later be served as if it had been.
    expect(s3.objects.has("products/p1/v1/fails")).toBe(false);
  });

  it("throws when the provider refuses a read, rather than returning empty bytes", async () => {
    await storage.put("products/p1/v1/flaky", Buffer.from("real"), "application/pdf");
    s3.failNext(503);
    await expect(storage.open("products/p1/v1/flaky"))
      .rejects.toBeInstanceOf(ContentUnavailableError);
    // An empty Buffer here would be delivered to a buyer as their file AND
    // would spend one of their downloads.
  });

  it("refuses a wrong secret at the server, proving the check is real", async () => {
    const wrong = new S3ContentStorage({
      endpoint: s3.endpoint, region: "us-east-1", bucket: s3.bucket,
      accessKeyId: s3.accessKeyId, secretAccessKey: "not-the-key",
      forcePathStyle: true,
    });
    await expect(wrong.put("products/p1/v1/nope", Buffer.from("x"), "application/pdf"))
      .rejects.toBeInstanceOf(StorageWriteFailedError);
    expect(s3.seen.some((r) => !r.authorized), "the server rejected it").toBe(true);
  });
});

// ===========================================================================

describe("configuration is checked at construction, not at first download", () => {
  const complete = {
    endpoint: "https://example.com", region: "auto", bucket: "b",
    accessKeyId: "k", secretAccessKey: "s",
  };

  it("refuses to construct with anything missing", () => {
    for (const missing of ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"] as const) {
      expect(
        () => new S3ContentStorage({ ...complete, [missing]: "" }),
        `${missing} missing must refuse`,
      ).toThrow(StorageNotConfiguredError);
    }
  });

  it("constructs when everything is present", () => {
    expect(() => new S3ContentStorage(complete)).not.toThrow();
  });
});

// ===========================================================================

describe("keys stay opaque and cannot escape the bucket", () => {
  it("refuses a traversal before a request is ever made", async () => {
    const before = s3.seen.length;
    for (const key of ["../secret", "products/../../etc/passwd", "/absolute", ""]) {
      await expect(storage.open(key), `"${key}" must be refused`)
        .rejects.toBeInstanceOf(InvalidStorageKeyError);
    }
    expect(s3.seen.length, "nothing left the process").toBe(before);
  });
});

// ===========================================================================

/**
 * What the seller is allowed to read when a write fails.
 *
 * The server action that attaches a file renders `error.message` straight onto
 * the seller's screen. A provider's error body names the bucket, the object key
 * and an account id — so an upload failure is one of the few places where the
 * infrastructure could walk out through the UI, and it does so on a path any
 * seller can trigger by uploading while the bucket is unhappy.
 */
describe("a failed write says nothing about where the bytes were going", () => {
  it("keeps the bucket, the key and the provider's words out of the message", async () => {
    s3.failNext(403);
    const error = await storage
      .put("products/p9/v9/a9", Buffer.from("x"), "application/pdf")
      .then(() => null, (e: unknown) => e as Error);

    expect(error, "the write must fail").not.toBeNull();
    const message = `${error?.name} ${error?.message}`;
    for (const secret of [s3.bucket, "products/p9/v9/a9", new URL(s3.endpoint).host, "403"]) {
      expect(message, `"${secret}" must not be in what the seller sees`)
        .not.toContain(secret);
    }
    expect((error as { code?: string }).code).toBe("content.write_failed");
  });

  it("still fails loudly rather than pretending the file was saved", async () => {
    s3.failNext(500);
    await expect(storage.put("products/p9/v9/a8", Buffer.from("y"), "application/pdf"))
      .rejects.toThrow();
    // And nothing was stored under that key, so a later read is a clean miss
    // rather than a truncated file.
    await expect(storage.open("products/p9/v9/a8")).rejects.toBeInstanceOf(ContentUnavailableError);
  });
});
