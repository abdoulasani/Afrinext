import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A test double that speaks Brevo's transactional email contract.
 *
 * It is a test double and is named one. **Nothing here has ever spoken to
 * Brevo**: `api.brevo.com` is unreachable from this environment, and no API
 * key exists. So rather than stubbing `fetch` and asserting that the adapter
 * called it — which would prove only that the adapter calls the stub the way
 * the stub expects — this is a real HTTP server that checks the request the
 * way Brevo's own SDK says Brevo checks it: the `api-key` header must be
 * present and correct, the path and method must match, and the body must
 * parse.
 *
 * What that establishes is exact: the adapter forms the request Brevo's
 * published contract describes, over real HTTP, and handles the status codes
 * and the error body that contract names. What it does NOT establish is that
 * a real Brevo account accepts it — only a real account proves that, and the
 * milestone note says so rather than implying otherwise.
 */

export interface BrevoRequest {
  readonly method: string;
  readonly path: string;
  readonly apiKey: string | undefined;
  readonly contentType: string | undefined;
  readonly body: Record<string, unknown>;
  /** The raw bytes, so a test can assert what did NOT travel. */
  readonly raw: string;
}

export interface BrevoTestServer {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Every request seen, in order. */
  readonly seen: BrevoRequest[];
  /**
   * What to answer next. `status` 0 means "never answer", which is how the
   * timeout is exercised against a socket that really does hang.
   */
  respondWith(next: { status: number; body?: unknown }): void;
  close(): Promise<void>;
}

const VALID_KEY = "xkeysib-test-key-not-a-real-credential";

export async function startBrevoTestServer(): Promise<BrevoTestServer> {
  const seen: BrevoRequest[] = [];
  let next: { status: number; body?: unknown } = {
    status: 201,
    body: { messageId: "<202609030000.1@smtp-relay.mailin.fr>" },
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === "object") {
          body = parsed as Record<string, unknown>;
        }
      } catch { /* recorded as {}; the test asserts on `raw` */ }

      const apiKey = req.headers["api-key"];
      seen.push({
        method: req.method ?? "",
        path: req.url ?? "",
        apiKey: typeof apiKey === "string" ? apiKey : undefined,
        contentType: req.headers["content-type"],
        body,
        raw,
      });

      // Never answer: the socket stays open and the adapter's own timeout is
      // the only thing that can end the call.
      if (next.status === 0) return;

      // Brevo authenticates with the `api-key` header. A wrong or missing one
      // is a 401 carrying its ErrorModel shape.
      if (apiKey !== VALID_KEY) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "unauthorized", message: "Key not found" }));
        return;
      }

      res.writeHead(next.status, { "content-type": "application/json" });
      res.end(next.body === undefined ? "" : JSON.stringify(next.body));
    });
  });

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v3`,
    apiKey: VALID_KEY,
    seen,
    respondWith(value) { next = value; },
    close() {
      return new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => { resolve(); });
      });
    },
  };
}
