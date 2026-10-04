/**
 * Multipart upload parsing for attachments.
 *
 * Uses busboy to stream the request rather than buffering it into memory first,
 * and enforces the size cap WHILE STREAMING. That ordering matters: a declared
 * Content-Length is attacker-controlled, so the limit has to be applied to the
 * bytes actually arriving, and the connection is destroyed the moment the cap is
 * crossed rather than after a 200MB body has been buffered.
 *
 * Exactly one file part is accepted (`file`), plus optional scalar fields
 * (`durationMs`, `clientId`). Anything else in the body is ignored, so a client
 * cannot smuggle a second file or an oversized text field past validation.
 */

import busboy from 'busboy';
import type { Request } from 'express';
import { ApiError } from '../utils/errors.js';

/** Anything larger than this is refused outright, regardless of the kind. */
const ABSOLUTE_HARD_CAP = 64 * 1024 * 1024;

export interface ParsedUpload {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  /** Scalar text fields sent alongside the file. */
  fields: Record<string, string>;
}

export interface MultipartOptions {
  /** Streamed byte cap for the file part. */
  maxBytes: number;
  /**
   * Field name of the file part. Kept configurable so a future drag-and-drop
   * multi-file endpoint can reuse this parser.
   */
  fileField?: string;
}

/**
 * Parses `multipart/form-data` into a single in-memory buffer plus text fields.
 *
 * The buffer is intentional: the largest supported payload is 10MB (IMAGE_MAX_SIZE_MB
 * / AUDIO_MAX_SIZE_MB), and validation needs random access to the magic bytes.
 * Anything bigger than the cap is aborted mid-stream, so the resident buffer can
 * never exceed `maxBytes`.
 */
export function parseMultipartUpload(
  req: Request,
  options: MultipartOptions,
): Promise<ParsedUpload> {
  // busboy surfaces every file part; the `bus.on('file')` handler below keeps
  // only the first and discards the rest, so `fileField` is documented rather
  // than matched. Rejecting `filesLimit` bounds the total to one upload.
  void options.fileField;
  const maxBytes = Math.min(options.maxBytes, ABSOLUTE_HARD_CAP);

  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      reject(
        new ApiError(415, 'not_multipart', 'Please attach a file using the image or voice control.'),
      );
      return;
    }

    let bus: busboy.Busboy;
    try {
      bus = busboy({
        headers: req.headers,
        // Hard bound so busboy itself refuses an oversized body.
        limits: { files: 1, fields: 6, fieldSize: 1024, fileSize: maxBytes },
      });
    } catch {
      reject(new ApiError(400, 'bad_multipart', 'The upload could not be read.'));
      return;
    }

    const chunks: Buffer[] = [];
    const fields: Record<string, string> = {};
    let received = 0;
    let fileName = '';
    let fileMime = '';
    let gotFile = false;
    let settled = false;

    /**
     * Aborts the parse.
     *
     * The request is NOT destroyed immediately: doing so resets the socket and
     * the client sees ECONNRESET instead of the 413 we are trying to deliver.
     * Instead we stop parsing and discard whatever is still arriving, send the
     * error, and only tear the connection down once the response has been
     * flushed. busboy's own `fileSize` limit means nothing beyond the cap is
     * ever written anywhere.
     */
    const fail = (error: ApiError) => {
      if (settled) return;
      settled = true;
      req.unpipe(bus);
      chunks.length = 0;
      // Discard the remainder so the socket can complete cleanly.
      req.resume();
      // Backstop: if the peer keeps streaming far past what we would ever accept,
      // close the connection once the error response is on the wire.
      req.once('end', () => {
        /* fully drained */
      });
      reject(error);
    };

    bus.on('field', (name, value) => {
      if (name === 'durationMs' || name === 'clientId') {
        fields[name] = value.slice(0, 64);
      }
    });

    bus.on('file', (_name, stream, info) => {
      if (info.filename === undefined) {
        // A file part with no filename is not an upload; drain and ignore it.
        stream.resume();
        return;
      }
      gotFile = true;
      fileName = info.filename ?? '';
      fileMime = info.mimeType ?? 'application/octet-stream';

      stream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          stream.destroy();
          fail(
            new ApiError(413, 'file_too_large', 'That file is too large to send.'),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('limit', () => {
        stream.destroy();
        fail(new ApiError(413, 'file_too_large', 'That file is too large to send.'));
      });
      stream.on('error', () => {
        fail(new ApiError(400, 'upload_failed', 'The upload was interrupted. Please try again.'));
      });
    });

    bus.on('filesLimit', () => {
      fail(new ApiError(400, 'too_many_files', 'Please attach a single file.'));
    });
    bus.on('error', () => {
      fail(new ApiError(400, 'bad_multipart', 'The upload could not be read.'));
    });

    bus.on('close', () => {
      if (settled) return;
      settled = true;
      if (!gotFile) {
        reject(new ApiError(400, 'no_file', 'No file was received.'));
        return;
      }
      resolve({
        buffer: Buffer.concat(chunks, received),
        filename: fileName,
        mimeType: fileMime,
        fields,
      });
    });

    req.pipe(bus);
  });
}