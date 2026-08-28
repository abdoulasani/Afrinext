import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A test double that speaks enough of the S3 API to hold the adapter to
 * account — and, critically, that CHECKS ITS SIGNATURES.
 *
 * It is a test double and is named one. No S3 server can run in this
 * environment: there is no Docker daemon and the MinIO binary is not
 * reachable through the proxy. So rather than mocking `fetch` and asserting
 * that the adapter called it — which would prove nothing about whether a real
 * bucket would accept the request — this is a real HTTP server that
 * independently recomputes AWS Signature Version 4 from the request it
 * received and answers 403 when the adapter's signature does not match.
 *
 * That makes every adapter test a signing test. What it establishes is exact:
 * the adapter forms correct canonical requests, derives the signing key
 * correctly, and round-trips bytes and content types over real HTTP. What it
 * does NOT establish is that a particular vendor accepts those requests. Only
 * a real bucket proves that, and nothing here claims otherwise.
 */

export interface S3TestServer {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Every request seen, so a test can assert what was sent. */
  readonly seen: Array<{ method: string; path: string; authorized: boolean }>;
  /** Direct access to stored bytes, for assertions the API cannot make. */
  readonly objects: Map<string, { bytes: Buffer; contentType: string }>;
  /** Makes the next N requests fail with this status. Transport-failure tests. */
  failNext(status: number, count?: number): void;
  close(): Promise<void>;
}

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();
const sha256Hex = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9._~-]/.test(ch)) out += ch;
    else if (ch === "/") out += encodeSlash ? "%2F" : "/";
    else for (const b of Buffer.from(ch, "utf8")) {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

export async function startS3TestServer(options: {
  bucket?: string; accessKeyId?: string; secretAccessKey?: string;
  /**
   * Serves GETs with no signature at all — a bucket somebody flipped public.
   *
   * Exists so the check that is SUPPOSED to catch that can be tested against a
   * bucket that actually has the defect. A safety check nothing has ever seen
   * fail is a safety check nobody knows the shape of.
   */
  publicReads?: boolean;
} = {}): Promise<S3TestServer> {
  const bucket = options.bucket ?? "afrinext-test";
  const accessKeyId = options.accessKeyId ?? "AKIAIOSFODNN7EXAMPLE";
  const secretAccessKey = options.secretAccessKey ?? "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const seen: Array<{ method: string; path: string; authorized: boolean }> = [];
  let failFor = 0;
  let failStatus = 500;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "/").split("?")[0] ?? "/";

      // Recompute the signature from what actually arrived.
      const auth = req.headers["authorization"] ?? "";
      const amzDate = String(req.headers["x-amz-date"] ?? "");
      const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
      const signedHeaders = /SignedHeaders=([^,]+)/.exec(auth)?.[1] ?? "";
      const claimed = /Signature=([0-9a-f]+)/.exec(auth)?.[1] ?? "";
      const scope = /Credential=[^/]+\/([^,]+)/.exec(auth)?.[1] ?? "";
      const [date = "", region = ""] = scope.split("/");

      const canonicalHeaders = signedHeaders.split(";")
        .map((n) => `${n}:${String(req.headers[n] ?? "").trim().replace(/\s+/g, " ")}\n`)
        .join("");
      const canonicalRequest = [
        req.method ?? "GET", uriEncode(path, false), "",
        canonicalHeaders, signedHeaders, payloadHash,
      ].join("\n");
      const stringToSign = [
        "AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest),
      ].join("\n");
      const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), "s3"), "aws4_request");
      const expected = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");

      const ok = claimed.length === expected.length &&
        timingSafeEqual(Buffer.from(claimed), Buffer.from(expected));
      seen.push({ method: req.method ?? "GET", path, authorized: ok });

      if (!ok) {
        if (options.publicReads === true && (req.method ?? "GET") === "GET") {
          const prefix = `/${bucket}/`;
          const found = path.startsWith(prefix)
            ? objects.get(decodeURIComponent(path.slice(prefix.length)))
            : undefined;
          if (found === undefined) { res.writeHead(404).end("NoSuchKey"); return; }
          res.writeHead(200, { "content-type": found.contentType }).end(found.bytes);
          return;
        }
        res.writeHead(403).end("SignatureDoesNotMatch"); return;
      }

      // The body must hash to what the signature covered, which is what makes
      // a truncated or altered upload a signature failure rather than a
      // silently corrupted object.
      if (body.byteLength > 0 && sha256Hex(body) !== payloadHash) {
        res.writeHead(400).end("XAmzContentSHA256Mismatch"); return;
      }

      if (failFor > 0) { failFor -= 1; res.writeHead(failStatus).end("Injected"); return; }

      const prefix = `/${bucket}/`;
      if (!path.startsWith(prefix)) { res.writeHead(404).end("NoSuchBucket"); return; }
      const objectKey = decodeURIComponent(path.slice(prefix.length));

      if (req.method === "PUT") {
        objects.set(objectKey, {
          bytes: body,
          contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
        });
        res.writeHead(200).end();
      } else if (req.method === "GET") {
        const found = objects.get(objectKey);
        if (found === undefined) { res.writeHead(404).end("NoSuchKey"); return; }
        res.writeHead(200, { "content-type": found.contentType }).end(found.bytes);
      } else if (req.method === "DELETE") {
        objects.delete(objectKey);
        res.writeHead(204).end();
      } else {
        res.writeHead(405).end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket, accessKeyId, secretAccessKey, seen, objects,
    failNext(status: number, count = 1) { failStatus = status; failFor = count; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
