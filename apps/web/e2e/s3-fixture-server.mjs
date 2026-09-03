/*
 * The S3-compatible bucket the multi-instance browser test shares.
 *
 * A test double, and named one: no real S3 server can run in this environment
 * (no Docker daemon, and the MinIO binary is not reachable through the proxy).
 * It verifies the AWS SigV4 signature of every request and answers 403 on a
 * mismatch, so the two application instances are not merely talking to a bucket
 * — they are proving they can sign for it.
 *
 * Started by Playwright as a webServer so its lifetime matches the run's.
 */
import { createServer } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.S3_FIXTURE_PORT ?? 3105);
const BUCKET = "afrinext-e2e";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

const objects = new Map();
const hmac = (k, d) => createHmac("sha256", k).update(d, "utf8").digest();
const sha256Hex = (d) => createHash("sha256").update(d).digest("hex");
const uriEncode = (v, slash) => {
  let out = "";
  for (const ch of v) {
    if (/[A-Za-z0-9._~-]/.test(ch)) out += ch;
    else if (ch === "/") out += slash ? "%2F" : "/";
    else for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
};

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/__health") { res.writeHead(200).end("ok"); return; }

    const auth = req.headers["authorization"] ?? "";
    const amzDate = String(req.headers["x-amz-date"] ?? "");
    const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
    const signedHeaders = /SignedHeaders=([^,]+)/.exec(auth)?.[1] ?? "";
    const claimed = /Signature=([0-9a-f]+)/.exec(auth)?.[1] ?? "";
    const scope = /Credential=[^/]+\/([^,]+)/.exec(auth)?.[1] ?? "";
    const [date = "", region = ""] = scope.split("/");
    const canonicalHeaders = signedHeaders.split(";")
      .map((n) => `${n}:${String(req.headers[n] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
    const canonicalRequest = [req.method, uriEncode(path, false), "",
      canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
    const key = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date), region), "s3"), "aws4_request");
    const expected = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
    if (claimed.length !== expected.length ||
        !timingSafeEqual(Buffer.from(claimed), Buffer.from(expected))) {
      res.writeHead(403).end("SignatureDoesNotMatch"); return;
    }

    // The signature covers the payload HASH, not the payload. A server that
    // never compares the two accepts a body swapped in flight under a valid
    // signature — so the check that makes the signature mean anything is here.
    if (body.length > 0 && sha256Hex(body) !== payloadHash) {
      res.writeHead(400).end("XAmzContentSHA256Mismatch"); return;
    }

    const prefix = `/${BUCKET}/`;
    if (!path.startsWith(prefix)) { res.writeHead(404).end("NoSuchBucket"); return; }
    const objectKey = decodeURIComponent(path.slice(prefix.length));

    if (req.method === "PUT") {
      objects.set(objectKey, { bytes: body,
        contentType: String(req.headers["content-type"] ?? "application/octet-stream") });
      res.writeHead(200).end();
    } else if (req.method === "GET") {
      const found = objects.get(objectKey);
      if (!found) { res.writeHead(404).end("NoSuchKey"); return; }
      res.writeHead(200, { "content-type": found.contentType }).end(found.bytes);
    } else if (req.method === "DELETE") {
      objects.delete(objectKey); res.writeHead(204).end();
    } else res.writeHead(405).end();
  });
}).listen(PORT, "127.0.0.1", () => console.log(`s3 fixture on ${PORT}, bucket ${BUCKET}`));
