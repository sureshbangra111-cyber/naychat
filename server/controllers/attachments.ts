/**
 * Attachment endpoints.
 *
 * This router is mounted at /api and is reachable by BOTH an anonymous visitor
 * session and an authenticated admin, because media is shown in the customer
 * chat and in the admin console through exactly the same route.
 *
 * Route summary (auth column = what the SERVER requires, never the request body):
 *
 *   POST   /conversations/:id/attachments        visitor owns the conversation
 *   DELETE /conversations/:id/attachments/:aid   uploader, still pending
 *   POST   /admin/conversations/:id/attachments  admin session
 *   GET    /attachments/:id                      conversation owner OR admin
 *
 * There is no route that serves a file without going through the authorisation
 * check in authorizeAttachmentRead().
 */

import { Router } from 'express';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { attachAdmin, attachVisitor, requireVisitor } from '../middleware/auth.js';
import { parseMultipartUpload } from '../middleware/upload.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireObjectId } from '../utils/validate.js';
import { notFound, unauthorized } from '../utils/errors.js';
import { config } from '../config/env.js';
import { getAttachmentStorage } from '../services/attachments/storage.js';
import { sanitizeFilename } from '../services/attachments/validation.js';
import {
  authorizeAttachmentRead,
  createAttachment,
  discardPendingAttachment,
} from '../services/attachments/service.js';

export const attachmentsRouter = Router();

/**
 * Upload-specific rate limit. Separate from the global API budget so a burst of
 * large media uploads cannot exhaust the allowance a normal chat relies on, and
 * so a media flood is throttled on its own terms.
 */
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'Too many uploads. Please wait a moment.' },
  },
});

/** Largest possible payload, used to bound the multipart parser. */
function uploadCap(): number {
  return Math.max(config.attachments.maxImageBytes, config.attachments.maxAudioBytes);
}

// -----------------------------------------------------------------------------
// Upload — customer
// -----------------------------------------------------------------------------

attachmentsRouter.post(
  '/conversations/:id/attachments',
  attachVisitor,
  requireVisitor,
  uploadLimiter,
  asyncHandler(async (req: Request, res) => {
    const conversationId = requireObjectId(req.params.id, 'conversation id');
    const upload = await parseMultipartUpload(req, { maxBytes: uploadCap() });

    const attachment = await createAttachment({
      conversationId,
      // Identity comes from the session-resolved visitor, not the request.
      uploaderType: 'customer',
      uploaderVisitorRef: req.visitor!.visitorId,
      buffer: upload.buffer,
      declaredMime: upload.mimeType,
      declaredFilename: upload.filename,
      durationMs: upload.fields.durationMs,
    });

    res.status(201).json({ attachment });
  }),
);

/** Cancel before sending: drop an upload that no message will ever reference. */
attachmentsRouter.delete(
  '/conversations/:id/attachments/:attachmentId',
  attachVisitor,
  requireVisitor,
  asyncHandler(async (req: Request, res) => {
    requireObjectId(req.params.id, 'conversation id');
    const attachmentId = requireObjectId(req.params.attachmentId, 'attachment id');
    const removed = await discardPendingAttachment({
      attachmentId,
      uploaderType: 'customer',
      uploaderVisitorRef: req.visitor!.visitorId,
    });
    // A missing row means it was already claimed or never existed — both are
    // indistinguishable to the caller on purpose.
    res.json({ removed });
  }),
);

// -----------------------------------------------------------------------------
// Upload — admin
// -----------------------------------------------------------------------------

attachmentsRouter.post(
  '/admin/conversations/:id/attachments',
  attachAdmin,
  asyncHandler(async (req: Request, res) => {
    if (!req.admin) throw unauthorized('Admin sign-in required.', 'admin_unauthorized');
    const conversationId = requireObjectId(req.params.id, 'conversation id');
    const upload = await parseMultipartUpload(req, { maxBytes: uploadCap() });

    const attachment = await createAttachment({
      conversationId,
      // Sender is stamped from the session; the request body has no say in it.
      uploaderType: 'admin',
      uploaderAdminRef: req.admin.id,
      buffer: upload.buffer,
      declaredMime: upload.mimeType,
      declaredFilename: upload.filename,
      durationMs: upload.fields.durationMs,
    });

    res.status(201).json({ attachment });
  }),
);

attachmentsRouter.delete(
  '/admin/conversations/:id/attachments/:attachmentId',
  attachAdmin,
  asyncHandler(async (req: Request, res) => {
    requireObjectId(req.params.id, 'conversation id');
    if (!req.admin) throw unauthorized('Admin sign-in required.', 'admin_unauthorized');
    const attachmentId = requireObjectId(req.params.attachmentId, 'attachment id');
    const removed = await discardPendingAttachment({
      attachmentId,
      uploaderType: 'admin',
      uploaderAdminRef: req.admin.id,
    });
    res.json({ removed });
  }),
);

// -----------------------------------------------------------------------------
// Authorised read — the ONLY way to obtain attachment bytes
// -----------------------------------------------------------------------------

attachmentsRouter.get(
  '/attachments/:id',
  attachAdmin,
  attachVisitor,
  asyncHandler(async (req: Request, res) => {
    const attachmentId = requireObjectId(req.params.id, 'attachment id');

    const access = await authorizeAttachmentRead(attachmentId, {
      // Both come from the session. `isAdmin` is only true when a valid,
      // unexpired admin session cookie resolved above.
      visitorId: req.visitor?.visitorId ?? null,
      isAdmin: Boolean(req.admin),
    });

    // A uniform 404 for unknown ids, another visitor's media and a missing
    // session alike: the response must never reveal which attachments exist.
    if (!access) throw notFound('Attachment not found.', 'attachment_not_found');

    // `viewer` is available here (customer vs admin) but is deliberately not
    // used to vary the response: an admin and the owning visitor must receive
    // byte-identical headers so the route cannot be used to distinguish callers.
    const { attachment } = access;
    let stream;
    try {
      stream = await getAttachmentStorage().getStream(attachment.storageKey);
    } catch {
      throw notFound('Attachment not found.', 'attachment_missing');
    }

    // --- Response hardening -------------------------------------------------
    // `nosniff` plus the DETECTED type means a browser can never sniff an HTML
    // or SVG payload out of a stored image. `attachment` (rather than `inline`)
    // for downloads; images and audio still render inline because their types
    // are raster/audio only.
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // The filename here is already sanitised metadata; quoting it as a
    // filename* parameter prevents header injection via the name.
    const safeName = sanitizeFilename(
      attachment.originalName,
      attachment.kind === 'audio' ? 'voice-message' : 'image',
    );
    const encoded = encodeURIComponent(safeName);
    res.setHeader(
      'Content-Disposition',
      `${attachment.kind === 'audio' ? 'inline' : 'inline'}; filename="attachment"; filename*=UTF-8''${encoded}`,
    );

    // Range support so audio can be seeked without downloading the whole file.
    const range = req.headers.range;
    const parsedRange = range ? parseRangeHeader(range, attachment.size) : null;
    if (parsedRange) {
      const { start, end } = parsedRange;
      const ranged = await getAttachmentStorage().getStreamRange(
        attachment.storageKey,
        start,
        end,
      );
      stream.destroy();
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${attachment.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      // 206 responses must not keep the full-length Content-Length set earlier.
      ranged.on('error', () => res.end());
      ranged.pipe(res);
      return;
    }
    if (parsedRange === null && range) {
      // Unsatisfiable range -> 416 so a player retries from the start.
      res.status(416);
      res.setHeader('Content-Range', `bytes */${attachment.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.end();
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.end();
    });

    stream.pipe(res);
  }),
);

/**
 * Parses a single-range `Range: bytes=a-b` header against a known object size.
 * Returns null when the range is malformed or unsatisfiable. Multi-range
 * requests are deliberately refused: no client here needs them and honouring
 * them would mean assembling multipart/byteranges responses.
 */
function parseRangeHeader(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return null;

  let start: number;
  let end: number;

  if (startRaw === '') {
    // Suffix form `bytes=-500`: the final `500` bytes.
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}