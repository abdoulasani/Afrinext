import { describe, expect, it } from "vitest";
import { FilesystemContentStorage } from "./storage";
import { S3ContentStorage } from "./s3";
import { assertCredentialsCannotTravelInClear, selectContentStorage } from "./select";

/**
 * The adapter a deployment ends up with, and — mostly — the ones it must not.
 *
 * Every case here is a misconfiguration that a silent fallback would turn into
 * a working-looking storefront that loses files. The bug this guards against
 * does not fail at startup or at upload: it fails days later, for one buyer,
 * on whichever instance happens to answer their download. So the assertions
 * are all about throwing early rather than about returning something usable.
 */
const S3_ENV = {
  CONTENT_STORAGE: "s3",
  CONTENT_S3_ENDPOINT: "https://s3.example.com",
  CONTENT_S3_REGION: "eu-west-3",
  CONTENT_S3_BUCKET: "afrinext",
  CONTENT_S3_ACCESS_KEY_ID: "AKIA",
  CONTENT_S3_SECRET_ACCESS_KEY: "secret",
} as const;

describe("choosing a content storage adapter", () => {
  it("gives a fully configured deployment the object store", () => {
    const storage = selectContentStorage(S3_ENV);
    expect(storage).toBeInstanceOf(S3ContentStorage);
    expect(storage.id).toBe("s3");
  });

  it("defaults to the local disk when nothing is said", () => {
    expect(selectContentStorage({})).toBeInstanceOf(FilesystemContentStorage);
  });

  // The mutation this test exists for: `s3` plus a missing bucket falling
  // through to a directory. Each field is removed on its own, because a
  // validation that checks four of five is the same bug with better odds.
  for (const missing of [
    "CONTENT_S3_ENDPOINT",
    "CONTENT_S3_REGION",
    "CONTENT_S3_BUCKET",
    "CONTENT_S3_ACCESS_KEY_ID",
    "CONTENT_S3_SECRET_ACCESS_KEY",
  ] as const) {
    it(`refuses s3 without ${missing}, rather than using local disk`, () => {
      const env: Record<string, string | undefined> = { ...S3_ENV };
      delete env[missing];
      let built: unknown;
      expect(() => { built = selectContentStorage(env); }).toThrowError(
        /storage_not_configured|is not set/i,
      );
      expect(built, "nothing was returned, least of all a filesystem adapter")
        .toBeUndefined();
    });

    it(`treats an empty ${missing} as missing, not as a value`, () => {
      expect(() => selectContentStorage({ ...S3_ENV, [missing]: "" })).toThrow();
    });
  }

  it("refuses local disk under a production build", () => {
    expect(() => selectContentStorage({ NODE_ENV: "production" })).toThrow();
    expect(() => selectContentStorage({
      NODE_ENV: "production",
      CONTENT_STORAGE: "filesystem",
    })).toThrow();
  });

  it("allows local disk under production only when said deliberately", () => {
    const storage = selectContentStorage({
      NODE_ENV: "production",
      ALLOW_LOCAL_CONTENT_STORAGE: "yes",
    });
    expect(storage).toBeInstanceOf(FilesystemContentStorage);
  });

  // "true", "1" and "YES" are not the flag. The mock payment provider and the
  // console sender take the same exact word, so a deployment cannot half-say it.
  for (const nearly of ["true", "1", "YES", "y", " yes"]) {
    it(`does not accept ALLOW_LOCAL_CONTENT_STORAGE="${nearly}"`, () => {
      expect(() => selectContentStorage({
        NODE_ENV: "production",
        ALLOW_LOCAL_CONTENT_STORAGE: nearly,
      })).toThrow();
    });
  }

  // SigV4 authenticates; it does not encrypt. Over http:// the Authorization
  // header and the seller's bytes are readable by anything on the path, and a
  // typo that drops the "s" would otherwise work perfectly.
  it("refuses a plaintext endpoint, because the credentials would be on the wire", () => {
    for (const endpoint of [
      "http://s3.example.com",
      "http://afrinext.r2.cloudflarestorage.com",
      "http://10.0.0.5:9000",
      "http://localhost:9000",       // a hosts file can point this anywhere
      "http://127.0.0.1.evil.test",  // not loopback, however much it looks it
    ]) {
      expect(
        () => selectContentStorage({ ...S3_ENV, CONTENT_S3_ENDPOINT: endpoint }),
        `${endpoint} must be refused`,
      ).toThrow(/clear|storage_not_configured/i);
    }
  });

  it("allows plaintext on literal loopback only, which is where the fixture runs", () => {
    for (const endpoint of ["http://127.0.0.1:3105", "http://[::1]:3105"]) {
      expect(
        () => selectContentStorage({ ...S3_ENV, CONTENT_S3_ENDPOINT: endpoint }),
        `${endpoint} is the test fixture`,
      ).not.toThrow();
    }
    expect(() => selectContentStorage({ ...S3_ENV, CONTENT_S3_ENDPOINT: "https://s3.example.com" }))
      .not.toThrow();
  });

  it("leaves a malformed endpoint to the adapter, which names the variable", () => {
    // Not this function's job to explain a typo it cannot parse; the point is
    // that it still refuses rather than proceeding.
    expect(() => assertCredentialsCannotTravelInClear("not-a-url")).not.toThrow();
    expect(() => selectContentStorage({ ...S3_ENV, CONTENT_S3_ENDPOINT: "not-a-url" }))
      .toThrow();
  });

  it("refuses an adapter name it does not know, in any environment", () => {
    // A typo must not resolve to the default. Under development too: a
    // developer who wrote "S3" should be told, not silently given a directory.
    expect(() => selectContentStorage({ CONTENT_STORAGE: "S3" })).toThrow();
    expect(() => selectContentStorage({ CONTENT_STORAGE: "r2" })).toThrow();
    expect(() => selectContentStorage({ CONTENT_STORAGE: "memory" })).toThrow();
  });

  it("never hands back an adapter that reports an unexpected identity", async () => {
    // A cheap guard on the one property the rest of the system reads.
    const storage = selectContentStorage({ CONTENT_STORAGE_DIR: "/tmp/afrinext-select-test" });
    expect(["filesystem", "s3"]).toContain(storage.id);
    // And it is a real adapter, not a stub: an absent object is an error.
    await expect(storage.open("products/none/none/none")).rejects.toThrow();
  });
});
