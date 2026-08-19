import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line) => { lines.push(line); } };
}

describe("structured logger", () => {
  it("emits one JSON object per line with bound context", () => {
    const { lines, sink } = capture();
    const log = createLogger({ requestId: "req-1" }, { level: "debug", sink });
    log.info("ledger posted", { ledgerTransactionId: "tx-1" });

    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry["level"]).toBe("info");
    expect(entry["msg"]).toBe("ledger posted");
    expect(entry["requestId"]).toBe("req-1");
    expect(entry["ledgerTransactionId"]).toBe("tx-1");
  });

  it("redacts secrets by key name, however they are cased or punctuated", () => {
    const { lines, sink } = capture();
    const log = createLogger({}, { level: "debug", sink });
    log.info("attempt", {
      password: "hunter2",
      API_Key: "sk-live-123",
      nested: { sessionToken: "abc", tokenHash: "def", safe: "keep" },
      authorization: "Bearer x",
    });

    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry["password"]).toBe("[redacted]");
    expect(entry["API_Key"]).toBe("[redacted]");
    expect(entry["authorization"]).toBe("[redacted]");
    const nested = entry["nested"] as Record<string, unknown>;
    expect(nested["sessionToken"]).toBe("[redacted]");
    expect(nested["tokenHash"]).toBe("[redacted]");
    expect(nested["safe"]).toBe("keep");
  });

  it("respects the level threshold", () => {
    const { lines, sink } = capture();
    const log = createLogger({}, { level: "warn", sink });
    log.debug("nope");
    log.info("nope");
    log.warn("yes");
    log.error("yes");
    expect(lines).toHaveLength(2);
  });

  it("serialises errors without leaking a stack into the payload body", () => {
    const { lines, sink } = capture();
    const log = createLogger({}, { level: "debug", sink });
    log.error("failed", { cause: new Error("boom") });
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry["cause"]).toEqual({ name: "Error", message: "boom" });
  });

  it("inherits bound context through child loggers", () => {
    const { lines, sink } = capture();
    const log = createLogger({ requestId: "r" }, { level: "debug", sink }).child({ actorUserId: "u" });
    log.info("hi");
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry["requestId"]).toBe("r");
    expect(entry["actorUserId"]).toBe("u");
  });
});
