/**
 * Structured logging foundation.
 *
 * One JSON object per line, with the request, actor and trace ids that make a
 * financial event traceable end to end. Secrets are redacted by key name on the
 * way out — the alternative is trusting every call site to remember, which
 * fails exactly once and then the token is in the log for ever.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = [
  "password", "passwordhash", "token", "tokenhash", "secret", "apikey", "api_key",
  "authorization", "cookie", "sessiontoken", "code", "codehash", "otp",
  "webhooksecret", "signature",
];

export interface LogContext {
  readonly requestId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly actorUserId?: string | undefined;
  readonly ledgerTransactionId?: string | undefined;
  readonly [key: string]: unknown;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACT_KEYS.includes(key.toLowerCase().replace(/[-_]/g, ""))
      ? "[redacted]"
      : redact(entry, depth + 1);
  }
  return output;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bound: LogContext): Logger;
}

export function createLogger(
  bound: LogContext = {},
  options: { level?: LogLevel; sink?: (line: string) => void } = {},
): Logger {
  const level = options.level ?? ((process.env["LOG_LEVEL"] as LogLevel | undefined) ?? "info");
  const sink = options.sink ?? ((line: string) => { process.stdout.write(`${line}\n`); });

  const emit = (severity: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_ORDER[severity] < LEVEL_ORDER[level]) return;
    const payload = {
      ts: new Date().toISOString(),
      level: severity,
      msg: message,
      ...(redact({ ...bound, ...context }) as Record<string, unknown>),
    };
    sink(JSON.stringify(payload));
  };

  return {
    debug: (m, c) => { emit("debug", m, c); },
    info: (m, c) => { emit("info", m, c); },
    warn: (m, c) => { emit("warn", m, c); },
    error: (m, c) => { emit("error", m, c); },
    child: (extra) => createLogger({ ...bound, ...extra }, options),
  };
}

export const logger = createLogger();
