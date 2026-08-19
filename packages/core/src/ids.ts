import { randomFillSync } from "node:crypto";

/**
 * UUIDv7: a 48-bit big-endian millisecond timestamp followed by randomness.
 *
 * Time-ordered, so primary keys cluster in the index instead of scattering
 * across the B-tree the way v4 does, and a row's approximate creation time is
 * recoverable from its id. Unlike a sequence it leaks no row count.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);

  const ts = BigInt(now);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // version 7 in the high nibble of byte 6, RFC 4122 variant in byte 8
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Extracts the embedded millisecond timestamp from a v7 uuid. */
export function uuidv7Timestamp(id: string): number {
  const hex = id.replace(/-/g, "").slice(0, 12);
  return Number(BigInt(`0x${hex}`));
}
