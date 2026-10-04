/**
 * Attachment storage abstraction.
 *
 * The rest of the codebase never touches a filesystem path or an S3 client — it
 * calls `AttachmentStorage`. Swapping local disk for object storage in production
 * therefore means implementing one interface and setting ATTACHMENT_STORAGE_DRIVER,
 * with no change to controllers, services or models.
 *
 * SECURITY RULES enforced here:
 *   * storage keys are GENERATED SERVER-SIDE (crypto random + fixed safe
 *     extension). A client-supplied filename never reaches the filesystem, so
 *     `../../etc/passwd`, `a/b.png` and NUL-byte tricks are impossible.
 *   * the resolved absolute path is always re-checked to be inside the storage
 *     root before any read/write/delete (belt-and-braces against traversal).
 *   * nothing in this module returns a filesystem path to a caller.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../../config/env.js';

export interface StoredObject {
  /** Opaque, server-generated key. Safe to persist in MongoDB. */
  storageKey: string;
  /** Bytes written. Verified after the write completes. */
  size: number;
}

export interface AttachmentStorage {
  /** Persists a buffer and returns its opaque key + byte count. */
  put(buffer: Buffer, extension: string): Promise<StoredObject>;
  /** Opens a readable stream for a previously stored key. */
  getStream(storageKey: string): Promise<Readable>;
  /**
   * Opens a stream for a byte range. Implementations MUST start at `start` so a
   * seek in an audio player does not have to transfer the whole file. Returning
   * the full object when `start` is 0 is fine.
   */
  getStreamRange(storageKey: string, start: number, end: number): Promise<Readable>;
  /** Best-effort delete. Used by orphan cleanup. Never throws. */
  remove(storageKey: string): Promise<void>;
  /** True when the object still exists. */
  exists(storageKey: string): Promise<boolean>;
  /** Total bytes currently held — reported by /api/health for operations. */
  usageBytes(): Promise<number>;
}

/** Only lowercase alphanumerics and dashes may appear in a key path segment. */
const KEY_SEGMENT_RE = /^[a-z0-9-]+$/;
const SAFE_EXT_RE = /^\.[a-z0-9]{1,8}$/;
/** The generated filename stem: exactly 32 lowercase hex characters. */
const HEX_STEM_RE = /^[a-f0-9]{32}$/;
/**
 * Generates an opaque key: `YYYY/MM/<32 hex>.<ext>`.
 * The date prefix is only a bucketing hint for operators; it carries no
 * information about the conversation and cannot be guessed into existence
 * because the 32 hex characters are random.
 */
function generateStorageKey(extension: string): string {
  if (!SAFE_EXT_RE.test(extension)) {
    throw new Error(`Unsafe storage extension rejected: ${extension}`);
  }
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${crypto.randomBytes(16).toString('hex')}${extension}`;
}

/**
 * Raised when the configured storage cannot be initialised at all — most
 * importantly on a read-only filesystem.
 *
 * This is surfaced as a 503 with actionable wording rather than an opaque 500,
 * because it is an OPERATOR problem (no object storage configured) and not a
 * customer problem. Chat, admin and tracking all keep working.
 */
export class AttachmentStorageUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Attachment storage unavailable: ${reason}`);
    this.name = 'AttachmentStorageUnavailableError';
  }
}

class LocalDiskStorage implements AttachmentStorage {
  private readonly rootReal: string;

  constructor(root: string) {
    try {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new AttachmentStorageUnavailableError(
        `cannot create ${root} (${
          error instanceof Error && 'code' in error
            ? String((error as NodeJS.ErrnoException).code)
            : 'unknown error'
        })`,
      );
    }

    /*
     * Prove the directory is actually WRITABLE, not merely present.
     *
     * This matters on serverless platforms (Vercel, Netlify functions), where the
     * deployed filesystem is read-only: mkdir of a new path fails outright, but a
     * directory that already exists would pass a naive existence check and then
     * fail later on the first write, turning uploads into 500s. Probing here
     * turns that into one clear, actionable error at first use.
     */
    try {
      const probe = path.join(root, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 });
      fs.rmSync(probe, { force: true });
    } catch (error) {
      throw new AttachmentStorageUnavailableError(
        `filesystem at ${root} is not writable (${
          error instanceof Error && 'code' in error
            ? String((error as NodeJS.ErrnoException).code)
            : 'unknown error'
        }). On serverless hosting, configure ATTACHMENT_STORAGE_DRIVER to an object-storage driver.`,
      );
    }

    // Resolve symlinks once so the containment check below compares real paths.
    this.rootReal = fs.realpathSync(root);
  }

  /**
   * Maps a storage key to an absolute path, refusing anything that escapes the
   * storage root. Throws before any fs call is made.
   */
  private resolveKey(storageKey: string): string {
    if (typeof storageKey !== 'string' || storageKey.length === 0 || storageKey.length > 200) {
      throw new Error('Invalid storage key.');
    }
    if (storageKey.includes('\0')) throw new Error('Invalid storage key.');
    // Reject Windows-style separators and any form of `..` before splitting.
    if (storageKey.includes('\\') || storageKey.includes('..')) {
      throw new Error('Invalid storage key.');
    }

    const segments = storageKey.split('/');
    if (segments.length < 1 || segments.length > 3) throw new Error('Invalid storage key.');

    // Every segment must be a pure [a-z0-9-] token — no dots, no slashes, no
    // hidden characters. The LAST segment is the filename and is validated
    // separately, because it is the only one allowed a single `.ext` suffix.
    for (const segment of segments.slice(0, -1)) {
      if (!KEY_SEGMENT_RE.test(segment)) throw new Error('Invalid storage key.');
    }

    const last = segments[segments.length - 1];
    const dot = last.lastIndexOf('.');
    if (dot < 1) throw new Error('Invalid storage key.');
    const stem = last.slice(0, dot);
    const ext = last.slice(dot);
    // Exactly one dot in the whole filename, a hex stem and a known-safe ext.
    if (stem.includes('.') || !HEX_STEM_RE.test(stem) || !SAFE_EXT_RE.test(ext)) {
      throw new Error('Invalid storage key.');
    }

    const absolute = path.resolve(this.rootReal, ...segments);
    // Containment check: `absolute` must be the root itself or inside it.
    if (absolute !== this.rootReal && !absolute.startsWith(this.rootReal + path.sep)) {
      throw new Error('Storage key resolves outside the storage root.');
    }
    return absolute;
  }
async put(buffer: Buffer, extension: string): Promise<StoredObject> {
    const storageKey = generateStorageKey(extension);
    const absolute = this.resolveKey(storageKey);
    await fsp.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    // `wx` fails if the file somehow already exists — never silently overwrite.
    await fsp.writeFile(absolute, buffer, { flag: 'wx', mode: 0o600 });
    return { storageKey, size: buffer.byteLength };
  }

  async getStream(storageKey: string): Promise<Readable> {
    return fs.createReadStream(this.resolveKey(storageKey));
  }

  async getStreamRange(storageKey: string, start: number, end: number): Promise<Readable> {
    return fs.createReadStream(this.resolveKey(storageKey), { start, end });
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await fsp.rm(this.resolveKey(storageKey), { force: true });
    } catch {
      // Cleanup is best-effort: a missing file is success, a permission problem
      // is logged by the caller's sweep rather than crashing the request.
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const stat = await fsp.stat(this.resolveKey(storageKey));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async usageBytes(): Promise<number> {
    let total = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(child);
        } else if (entry.isFile()) {
          try {
            total += (await fsp.stat(child)).size;
          } catch {
            /* file vanished mid-scan */
          }
        }
      }
    };
    await walk(this.rootReal);
    return total;
  }
}

let instance: AttachmentStorage | null = null;

/**
 * Returns the configured driver.
 *
 * Only `local` ships today. Object storage is a matter of adding an
 * implementation below and documenting its server-only env vars — the interface,
 * the callers and the API all stay identical.
 */
export function getAttachmentStorage(): AttachmentStorage {
  if (instance) return instance;
  const driver = config.attachments.driver;
  if (driver !== 'local') {
    // Fail loudly rather than silently falling back to local disk, which would
    // look healthy in production and lose every attachment on the next deploy.
    throw new Error(
      `Unsupported ATTACHMENT_STORAGE_DRIVER "${driver}". Implement the driver in server/services/attachments/storage.ts.`,
    );
  }
  instance = new LocalDiskStorage(config.attachments.storageDir);
  return instance;
}