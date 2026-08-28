import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { DomainError } from "../errors";

/**
 * Where the bytes of a digital asset live.
 *
 * The domain codes against this and never against a storage product, for the
 * same reason it codes against `PaymentProvider` rather than against a payment
 * company: the thing behind it will change, and when it does the change should
 * be an adapter rather than a rewrite.
 *
 * Two properties of this interface are the point:
 *
 *   - **Keys are opaque.** A key is not a URL and not a path a caller can
 *     construct. Nothing here returns a link, so no code path can accidentally
 *     hand a client something that reads bytes without going through the
 *     authorization the domain performs.
 *   - **Reads return bytes, not locations.** An object store's pre-signed URL
 *     is a perfectly good adapter for `open()` later, but it would be built
 *     *inside* an implementation of this port, where the entitlement check has
 *     already happened, and with a lifetime measured in seconds.
 *
 * No cloud storage is configured for Afrinext yet, and none is invented here.
 */
export interface StoredObject {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface ContentStorage {
  readonly id: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  open(key: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
}

export class ContentUnavailableError extends DomainError {
  override readonly name = "ContentUnavailableError";
  constructor(key: string) {
    super("content.unavailable", `The stored object "${key}" could not be read.`);
  }
}

/**
 * A write that did not land.
 *
 * Separate from `ContentUnavailableError` because of where it is SEEN: an
 * upload failure is rendered on the seller's screen by the server action, which
 * shows `error.message` verbatim. So this message carries no storage key, no
 * bucket, no endpoint and nothing the provider said — a provider's error body
 * names the bucket, the key and an account id, and a seller who can make an
 * upload fail must not be shown Afrinext's infrastructure. The detail is
 * logged instead, where an operator can read it.
 */
export class StorageWriteFailedError extends DomainError {
  override readonly name = "StorageWriteFailedError";
  constructor() {
    super(
      "content.write_failed",
      "The file could not be saved. Please try again.",
    );
  }
}

export class InvalidStorageKeyError extends DomainError {
  override readonly name = "InvalidStorageKeyError";
  constructor(key: string) {
    super("content.invalid_key", `"${key}" is not a usable storage key.`);
  }
}

/**
 * Keys are checked, not trusted.
 *
 * Every key this codebase writes is generated from a uuid, so nothing should
 * ever reach here with a traversal in it. "Should" is the word that makes this
 * function necessary: a filesystem implementation joins the key onto a root
 * directory, and `../../etc/passwd` is the oldest bug there is.
 */
const KEY_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export function assertUsableStorageKey(key: string): void {
  if (!KEY_SHAPE.test(key) || key.includes("..") || normalize(key) !== key) {
    throw new InvalidStorageKeyError(key);
  }
}

export function checksumOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Deterministic, in process. What the domain tests run against.
 *
 * Not a stand-in for production storage and not described as one — it is a Map,
 * and it exists so the access-control tests are about access control rather
 * than about a filesystem.
 */
export class InMemoryContentStorage implements ContentStorage {
  readonly id = "memory";
  private readonly objects = new Map<string, StoredObject>();

  put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    assertUsableStorageKey(key);
    this.objects.set(key, { bytes: Buffer.from(bytes), contentType });
    return Promise.resolve();
  }

  open(key: string): Promise<StoredObject> {
    assertUsableStorageKey(key);
    const found = this.objects.get(key);
    if (found === undefined) return Promise.reject(new ContentUnavailableError(key));
    return Promise.resolve(found);
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Test helper: how many objects are held. Never used by the domain. */
  get size(): number {
    return this.objects.size;
  }
}

/**
 * Bytes on a local disk, under one root directory.
 *
 * Honest about what it is: single-machine storage, suitable for development,
 * for CI, and for a single-server deployment — not for two web instances behind
 * a load balancer. An object-store adapter is the obvious next implementation,
 * and it is a new class in this file rather than a change anywhere else.
 *
 * The root is resolved once and every read and write is asserted to stay
 * beneath it, so a key that somehow escaped the shape check still cannot
 * escape the directory.
 */
export class FilesystemContentStorage implements ContentStorage {
  readonly id = "filesystem";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertUsableStorageKey(key);
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new InvalidStorageKeyError(key);
    }
    return full;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    // The content type travels beside the object rather than being guessed from
    // the extension later. Guessing is how a .pdf gets served as text/html.
    await writeFile(`${path}.type`, contentType, "utf8");
  }

  async open(key: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    try {
      const [bytes, contentType] = await Promise.all([
        readFile(path),
        readFile(`${path}.type`, "utf8"),
      ]);
      return { bytes, contentType: contentType.trim() };
    } catch {
      throw new ContentUnavailableError(key);
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  }
}
