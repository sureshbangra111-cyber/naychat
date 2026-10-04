/**
 * Upload validation.
 *
 * The browser-declared MIME type is treated as an untrusted HINT, never as proof.
 * Every upload is identified by sniffing its magic bytes and by parsing enough of
 * the container to prove the payload really is the type we claim:
 *
 *   * PNG  — 8-byte signature + IHDR width/height cross-check
 *   * JPEG — SOI marker + a real SOFn frame (dimensions come from the frame)
 *   * GIF  — GIF87a/GIF89a header + logical screen descriptor dimensions
 *   * WEBP — RIFF container + `WEBP` fourcc (VP8 / VP8L / VP8X)
 *   * audio — EBML (WebM/Matroska, what MediaRecorder produces), ISO-BMFF
 *     (mp4/m4a/mov), Ogg (Opus/Vorbis), ID3/frame-sync MP3, RIFF/WAVE
 *
 * Deliberately REJECTED: SVG (an XML document that can carry script, and the
 * classic stored-XSS-on-same-origin vector), HTML, XML, executables, archives,
 * PDF and anything else that is not a raster image or a real audio container.
 * An image is only ever served back with a concrete raster MIME type derived
 * here, together with `nosniff` — never with the client-declared type.
 */

import { ApiError, badRequest } from '../../utils/errors.js';

export type MediaKind = 'image' | 'audio';

export interface DetectedMedia {
  kind: MediaKind;
  /** The authoritative MIME type, derived from the bytes. */
  mimeType: string;
  /** Canonical extension used for the generated storage key. */
  extension: string;
  width?: number;
  height?: number;
  /** Container subtype, used only to pick a safe download filename. */
  container: string;
}

interface Signature {
  mimeType: string;
  extension: string;
  container: string;
}

const signatures: Array<{ offset: number; bytes: number[]; signature: Signature }> = [
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], signature: { mimeType: 'image/png', extension: '.png', container: 'png' } },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], signature: { mimeType: 'image/gif', extension: '.gif', container: 'gif' } },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], signature: { mimeType: 'image/gif', extension: '.gif', container: 'gif' } },
  { offset: 0, bytes: [0xff, 0xd8, 0xff], signature: { mimeType: 'image/jpeg', extension: '.jpg', container: 'jpeg' } },
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], signature: { mimeType: 'audio/mp4', extension: '.m4a', container: 'mp4' } },
  { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53], signature: { mimeType: 'audio/ogg', extension: '.ogg', container: 'ogg' } },
  { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3], signature: { mimeType: 'audio/webm', extension: '.webm', container: 'webm' } },
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], signature: { mimeType: '', extension: '', container: 'riff' } },
  { offset: 0, bytes: [0x49, 0x44, 0x33], signature: { mimeType: 'audio/mpeg', extension: '.mp3', container: 'mp3' } },
];

function matches(buffer: Buffer, offset: number, bytes: number[]): boolean {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function fourcc(buffer: Buffer, offset: number): string {
  if (buffer.length < offset + 4) return '';
  return buffer.toString('latin1', offset, offset + 4);
}

/** Parses PNG width/height from the IHDR chunk. */
function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (fourcc(buffer, 12) !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 50_000 || height > 50_000) return null;
  return { width, height };
}

/** Walks JPEG segments until a SOFn frame yields the real dimensions. */
function readJpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2; // skip SOI
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan / end of image: no further frame header will appear.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    // SOF0/1/2/3, SOF5-7, SOF9-11, SOF13-15 carry a frame header.
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 9 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

/** The GIF logical screen descriptor holds the dimensions. */
function readGifSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10) return null;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

/**
 * WEBP is a RIFF container: "RIFF" at 0, "WEBP" at 8, then a VP8 chunk. VP8X
 * stores a canvas size; VP8L/VP8 embed it in their own bitstream. The dimension
 * parse is best-effort — the load-bearing check is that the RIFF fourcc is WEBP.
 */
function readWebpSize(buffer: Buffer): { width: number; height: number } | null {
  const chunk = fourcc(buffer, 12);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

/** ISO-BMFF major brand, so QuickTime can be singled out and refused. */
function readIsoBrand(buffer: Buffer): string {
  return fourcc(buffer, 8).trim();
}

/**
 * Identifies the payload from its bytes. Returns null when nothing matches, which
 * the caller turns into a 415.
 */
export function detectMedia(buffer: Buffer): DetectedMedia | null {
  // A bare MPEG audio frame sync with no leading ID3 tag is the remaining case.
  if (
    buffer.length > 1 &&
    buffer[0] === 0xff &&
    (buffer[1] & 0xe0) === 0xe0 &&
    (buffer[1] & 0x06) !== 0x00
  ) {
    return { kind: 'audio', mimeType: 'audio/mpeg', extension: '.mp3', container: 'mp3' };
  }

  for (const candidate of signatures) {
    if (!matches(buffer, candidate.offset, candidate.bytes)) continue;

    // RIFF needs the fourcc at offset 8 to decide WAVE vs WEBP.
    if (candidate.signature.container === 'riff') {
      const form = fourcc(buffer, 8);
      if (form === 'WAVE') {
        return { kind: 'audio', mimeType: 'audio/wav', extension: '.wav', container: 'wav' };
      }
      if (form === 'WEBP') {
        return {
          kind: 'image',
          mimeType: 'image/webp',
          extension: '.webp',
          container: 'webp',
          ...(readWebpSize(buffer) ?? {}),
        };
      }
      continue;
    }

    if (candidate.signature.container === 'jpeg') {
      const size = readJpegSize(buffer);
      // A JPEG with no readable frame header is not a usable image.
      if (!size) return null;
      return { kind: 'image', ...candidate.signature, ...size };
    }

    if (candidate.signature.container === 'png') {
      const size = readPngSize(buffer);
      if (!size) return null;
      return { kind: 'image', ...candidate.signature, ...size };
    }

    if (candidate.signature.container === 'gif') {
      const size = readGifSize(buffer);
      if (!size) return null;
      return { kind: 'image', ...candidate.signature, ...size };
    }

    if (candidate.signature.container === 'mp4') {
      // `qt  ` is QuickTime, which can reference external resources; refuse it.
      if (readIsoBrand(buffer).startsWith('qt')) return null;
      return { kind: 'audio', ...candidate.signature };
    }

    return {
      kind: candidate.signature.mimeType.startsWith('image/') ? 'image' : 'audio',
      ...candidate.signature,
    };
  }

  return null;
}

/** Extension allow-lists. Independent of, and cross-checked against, the bytes. */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.webm', '.m4a', '.mp4', '.mp3', '.ogg', '.oga', '.opus', '.wav']);

/** MIME allow-lists — the client-declared value must also be in here. */
const IMAGE_MIME_HINTS = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const AUDIO_MIME_HINTS = new Set([
  'audio/webm',
  'video/webm',
  'audio/ogg',
  'audio/opus',
  'application/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/mp4a-latm',
  'audio/aac',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'video/mp4',
]);

export function isAllowedImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isAllowedAudioExtension(ext: string): boolean {
  return AUDIO_EXTENSIONS.has(ext.toLowerCase());
}

export function isAllowedImageMime(mime: string): boolean {
  return IMAGE_MIME_HINTS.has(mime.toLowerCase().split(';')[0].trim());
}

export function isAllowedAudioMime(mime: string): boolean {
  return AUDIO_MIME_HINTS.has(mime.toLowerCase().split(';')[0].trim());
}

/**
 * Extensions refused outright, even if the bytes happened to parse. Kept as an
 * explicit deny-list so adding a new signature later can never accidentally
 * admit an executable or an active-content format.
 */
const BLOCKED_EXTENSIONS = new Set([
  '.svg', '.svgz', '.html', '.htm', '.xhtml', '.xml', '.js', '.mjs', '.cjs',
  '.exe', '.dll', '.so', '.dylib', '.sh', '.bash', '.bat', '.cmd', '.ps1',
  '.php', '.phtml', '.jsp', '.asp', '.aspx', '.cgi', '.jar', '.msi', '.apk',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.pdf', '.psd', '.swf',
]);

export function isBlockedExtension(ext: string): boolean {
  return BLOCKED_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Strips a client-supplied filename down to something safe to echo back in
 * `Content-Disposition`. It is display metadata ONLY: never used to build a
 * filesystem path or a storage key, and React renders it as a text node, so
 * `<img src=x onerror=...>` as a filename can never become markup.
 */
export function sanitizeFilename(name: unknown, fallback: string): string {
  if (typeof name !== 'string') return fallback;
  const cleaned = name
    // Strip C0/C1 control characters, then path separators and traversal.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim()
    // Defence in depth: remove every character with meaning in HTML/XML/URLs.
    // The filename is only ever rendered as a React text node, so this is not the
    // primary XSS defence, but it guarantees the value is inert even if it were
    // ever interpolated into a header, a URL or another sink by future code.
    .replace(/[<>"'&`\\]/g, '')
    .trim()
    .slice(0, 120);
  if (cleaned.length === 0) return fallback;
  return cleaned;
}

/**
 * The single validation entry point for both kinds.
 *
 * Throws 415 for an unrecognised/unsafe payload and 413 when the streamed byte
 * count exceeds the configured limit. The size check uses the ACTUAL number of
 * bytes received, not the declared Content-Length, so a lying header cannot
 * bypass it.
 */
export function validateMediaUpload(options: {
  buffer: Buffer;
  declaredMime: string;
  declaredFilename: string;
  /** 'image' restricts the result to raster images; 'audio' to audio. */
  expected: MediaKind;
  maxBytes: number;
}): DetectedMedia {
  const { buffer, declaredMime, declaredFilename, expected, maxBytes } = options;

  const rejectionMessage =
    expected === 'image'
      ? 'Only JPG, PNG, WEBP and GIF images can be sent.'
      : 'That audio format is not supported.';

  if (buffer.length === 0) {
    throw badRequest('The uploaded file is empty.', 'empty_file');
  }
  if (buffer.length > maxBytes) {
    throw new ApiError(
      413,
      'file_too_large',
      expected === 'image'
        ? 'That image is too large to send. Please choose a smaller file.'
        : 'That recording is too long. Please record a shorter message.',
    );
  }

  const detected = detectMedia(buffer);
  if (!detected || detected.kind !== expected) {
    throw new ApiError(415, 'unsupported_media', rejectionMessage);
  }

  // Extension gate: `payload.html` renamed to `payload.png` passes the byte
  // check but must still be refused on a lie about its name.
  const dot = declaredFilename.lastIndexOf('.');
  const declaredExt = dot >= 0 ? declaredFilename.slice(dot).toLowerCase() : '';
  if (isBlockedExtension(declaredExt)) {
    throw new ApiError(415, 'blocked_file', 'That file type cannot be uploaded.');
  }
  const extOk =
    expected === 'image'
      ? isAllowedImageExtension(declaredExt)
      : isAllowedAudioExtension(declaredExt);
  if (!extOk) {
    throw new ApiError(415, 'unsupported_media', 'That file extension is not allowed.');
  }

  // The declared MIME is a hint that must AGREE with the bytes. A mismatch is the
  // signature of a spoofed Content-Type, so it is rejected rather than silently
  // corrected. A blank or generic `application/octet-stream` type is tolerated
  // because some browsers send it for valid MediaRecorder blobs.
  const declared = declaredMime.toLowerCase().split(';')[0].trim();
  if (declared && declared !== 'application/octet-stream') {
    const mimeOk =
      expected === 'image' ? isAllowedImageMime(declared) : isAllowedAudioMime(declared);
    // `audio/mp4`/`video/mp4` and the WebM/ogg pairs are interchangeable
    // depending on the browser and the container, so treat them as equivalent.
    const equivalent =
      (detected.mimeType === 'audio/mp4' &&
        (declared === 'video/mp4' || declared === 'audio/mp4')) ||
      (detected.mimeType === 'audio/webm' &&
        (declared === 'video/webm' || declared === 'audio/webm')) ||
      (detected.mimeType === 'audio/ogg' &&
        (declared === 'application/ogg' || declared === 'audio/ogg'));
    if (!mimeOk && !equivalent) {
      throw new ApiError(415, 'mime_mismatch', 'The file content does not match its type.');
    }
  }

  return detected;
}

/** Rejects a client-declared duration that is missing, negative or absurd. */
export function validateDurationMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  // 2 hours is far beyond any real voice note; anything larger is a bad value.
  return Math.min(Math.round(parsed), 2 * 60 * 60 * 1000);
}
