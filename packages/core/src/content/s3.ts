import { createHash, createHmac } from "node:crypto";
import {
  assertUsableStorageKey, ContentUnavailableError, StorageWriteFailedError,
  type ContentStorage, type StoredObject,
} from "./storage";
import { DomainError } from "../errors";
import { logger } from "../observability";

/**
 * Object storage, spoken over the S3 HTTP API.
 *
 * ---------------------------------------------------------------------------
 * Why S3-compatible rather than "S3"
 * ---------------------------------------------------------------------------
 *
 * One adapter serves AWS S3, Cloudflare R2, Backblaze B2, Scaleway, MinIO and
 * DigitalOcean Spaces, because they implement the same API. A deployment picks
 * a provider by setting an endpoint, not by shipping different code — which
 * matters most at exactly the moment vendor lock-in usually bites, when egress
 * pricing changes.
 *
 * ---------------------------------------------------------------------------
 * Why the request is signed by hand
 * ---------------------------------------------------------------------------
 *
 * `packages/core` has five runtime dependencies on purpose. This adapter needs
 * three verbs on one object, and Signature Version 4 is a published, closed
 * specification: a canonical request, a string to sign, a derived key, an HMAC.
 * Sixty lines of `node:crypto` is the same posture this codebase already takes
 * with its own HMAC content grants and its hand-written SQL.
 *
 * The risk is real — a subtly wrong signature fails only against a live server —
 * and it is answered twice. `signV4` is asserted against **AWS's own published
 * test vector**, so the canonicalisation and key derivation are checked against
 * a known-good answer rather than against one reading of the specification. And
 * every adapter test runs against a server that independently recomputes the
 * signature and refuses a mismatch.
 *
 * ---------------------------------------------------------------------------
 * `open()` returns BYTES
 * ---------------------------------------------------------------------------
 *
 * Never a URL, and that is the whole security posture of this file. The adapter
 * authenticates server-to-server with an Authorization header and reads the
 * response into a Buffer, so there is no pre-signed URL to leak, to log, to
 * share, or to outlive the request that made it. The browser keeps receiving
 * bytes from Afrinext's own origin through the one route that demands a session
 * and a grant.
 *
 * This adapter performs NO authorization. It cannot be reached until the
 * session, the grant, the entitlement, the version pin, the publication state
 * and the download limit have all passed — see `openContent`. Moving any of
 * that into storage would put an access decision behind a vendor's IAM.
 */

export interface S3Config {
  /** e.g. https://<account>.r2.cloudflarestorage.com — no bucket, no trailing slash. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * `https://host/bucket/key` instead of `https://bucket.host/key`.
   *
   * Required by MinIO and most S3-compatible providers; AWS itself prefers
   * virtual-host style. Getting this wrong produces a 404 that looks like a
   * missing object, which is why it is explicit rather than guessed.
   */
  readonly forcePathStyle?: boolean;
}

export class StorageNotConfiguredError extends DomainError {
  override readonly name = "StorageNotConfiguredError";
  constructor(missing: string) {
    super(
      "content.storage_not_configured",
      `Object storage is selected but ${missing} is not set. Refusing to start ` +
        "rather than silently falling back to local disk, which loses files the " +
        "moment a second instance serves a request.",
    );
  }
}

const UNSIGNED_PAYLOAD_HASH_EMPTY =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

const sha256Hex = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

/**
 * Percent-encoding, S3's way.
 *
 * `encodeURIComponent` leaves `!'()*` alone and AWS does not, and it encodes
 * `/` which a canonical object path must keep. Both differences produce a
 * signature mismatch rather than an error, so they are handled explicitly.
 */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9._~-]/.test(ch)) out += ch;
    else if (ch === "/") out += encodeSlash ? "%2F" : "/";
    else {
      for (const byte of Buffer.from(ch, "utf8")) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

export interface SignedRequest {
  readonly headers: Record<string, string>;
}

/**
 * AWS Signature Version 4, for a single request.
 *
 * Exported so it can be asserted against AWS's published test vector. The
 * `amzDate` parameter exists for that reason too: a signature is a function of
 * its timestamp, and a test that cannot fix the clock cannot check the answer.
 */
export function signV4(input: {
  method: string;
  /** Absolute path beginning with "/", already the canonical resource. */
  path: string;
  query?: string;
  host: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  /** ISO basic format: 20130524T000000Z. */
  amzDate: string;
  extraHeaders?: Readonly<Record<string, string>>;
}): SignedRequest {
  const service = input.service ?? "s3";
  const date = input.amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": input.amzDate,
    ...Object.fromEntries(
      Object.entries(input.extraHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders =
    signedNames.map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = signedNames.join(";");

  const canonicalRequest = [
    input.method,
    uriEncode(input.path, false),
    input.query ?? "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export class S3ContentStorage implements ContentStorage {
  readonly id = "s3";
  private readonly config: S3Config;

  constructor(config: S3Config) {
    for (const [name, value] of Object.entries({
      CONTENT_S3_ENDPOINT: config.endpoint,
      CONTENT_S3_REGION: config.region,
      CONTENT_S3_BUCKET: config.bucket,
      CONTENT_S3_ACCESS_KEY_ID: config.accessKeyId,
      CONTENT_S3_SECRET_ACCESS_KEY: config.secretAccessKey,
    })) {
      if (value === undefined || value === "") throw new StorageNotConfiguredError(name);
    }
    this.config = config;
  }

  /** Where this object lives, and the path the signature is computed over. */
  private target(key: string): { url: string; host: string; path: string } {
    assertUsableStorageKey(key);
    const base = new URL(this.config.endpoint);
    const encodedKey = key.split("/").map((s) => uriEncode(s, true)).join("/");
    if (this.config.forcePathStyle === true) {
      const path = `/${this.config.bucket}/${encodedKey}`;
      return { url: `${base.origin}${path}`, host: base.host, path };
    }
    const host = `${this.config.bucket}.${base.host}`;
    return { url: `${base.protocol}//${host}/${encodedKey}`, host, path: `/${encodedKey}` };
  }

  private send(
    method: string, key: string, body?: Buffer, contentType?: string,
  ): Promise<Response> {
    const { url, host, path } = this.target(key);
    const signed = signV4({
      method,
      path,
      host,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      // The hash of what is actually sent. S3 verifies it, so a body altered in
      // flight fails the signature rather than being stored corrupted.
      payloadHash: body === undefined ? UNSIGNED_PAYLOAD_HASH_EMPTY : sha256Hex(body),
      amzDate: new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
      ...(contentType !== undefined ? { extraHeaders: { "content-type": contentType } } : {}),
    });
    return fetch(url, {
      method,
      headers: signed.headers,
      ...(body !== undefined ? { body: new Uint8Array(body) } : {}),
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.send("PUT", key, bytes, contentType);
    if (!response.ok) {
      // The provider's body names a bucket, a key and an account id, and this
      // failure is rendered on the seller's screen. So it is logged here and
      // the thrown message says nothing about where the bytes were going.
      logger.child({ component: "content.s3" }).error("upload refused", {
        key, status: response.status, providerBody: await safeText(response),
      });
      throw new StorageWriteFailedError();
    }
  }

  async open(key: string): Promise<StoredObject> {
    const response = await this.send("GET", key);
    if (!response.ok) throw new ContentUnavailableError(key);
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      bytes,
      /*
       * The stored content type, or the one the domain refuses to guess.
       *
       * A missing header is answered with `application/octet-stream` rather
       * than with a sniff of the bytes: guessing is how a seller's .pdf gets
       * served as text/html, and the download route sets `nosniff` precisely so
       * nothing downstream repeats the guess.
       */
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async remove(key: string): Promise<void> {
    const response = await this.send("DELETE", key);
    // 404 is success: the object is not there, which is what was asked for.
    if (!response.ok && response.status !== 404) {
      logger.child({ component: "content.s3" }).error("delete refused", {
        key, status: response.status,
      });
      throw new StorageWriteFailedError();
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try { return (await response.text()).slice(0, 200); } catch { return "no body"; }
}
