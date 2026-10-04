/**
 * Media attachments.
 *
 * This document holds METADATA ONLY. The binary payload lives in the configured
 * `AttachmentStorage` driver and is addressed by an opaque, server-generated
 * `storageKey`. Nothing in this collection — and nothing in a Message document
 * — ever contains base64 or a GridFS ObjectId, so polling a conversation stays a
 * cheap metadata read regardless of how large the media is.
 *
 * Lifecycle:
 *   1. POST /api/.../attachments streams + validates + stores the bytes and
 *      writes a row with `state: 'pending'`.
 *   2. The client sends a message referencing that attachmentId; the message
 *      insert flips it to `state: 'attached'` atomically (claimAttachment).
 *   3. A pending row that is never claimed within ATTACHMENT_ORPHAN_TTL_MS is
 *      deleted together with its stored object by sweepOrphanAttachments().
 *
 * Authorisation is NEVER derived from this document alone: every read
 * re-resolves the owning conversation and checks the caller's session against
 * it. An attachment id in the URL is just a lookup key, never proof of access.
 */

import { Schema, model, type InferSchemaType } from 'mongoose';

export const MEDIA_KINDS = ['image', 'audio'] as const;
export type MediaKindValue = (typeof MEDIA_KINDS)[number];

export const ATTACHMENT_STATES = ['pending', 'attached'] as const;
export type AttachmentState = (typeof ATTACHMENT_STATES)[number];

const attachmentSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },

    /** Who uploaded it. Server-derived from the session, never from the body. */
    uploaderType: { type: String, enum: ['customer', 'admin'], required: true },
    /** Set only for admin uploads, from the authenticated session. */
    uploaderAdminRef: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    /** Server-resolved Visitor for customer uploads. Used for ownership checks. */
    uploaderVisitorRef: { type: Schema.Types.ObjectId, ref: 'Visitor', default: null },

    kind: { type: String, enum: MEDIA_KINDS, required: true },
    /** Authoritative type derived from the bytes in `validateMediaUpload`. */
    mimeType: { type: String, required: true, maxlength: 120 },
    /** Opaque server-generated key. Never a client filename, never a path. */
    storageKey: { type: String, required: true, maxlength: 300 },
    /** Verified byte count of the stored object. */
    size: { type: Number, required: true, min: 0 },

    /** Display metadata only — sanitised, never used to build a path. */
    originalName: { type: String, default: null, maxlength: 150 },

    // Image-only.
    width: { type: Number, default: null, min: 0 },
    height: { type: Number, default: null, min: 0 },

    // Audio-only. Client-measured, clamped server-side by validateDurationMs.
    durationMs: { type: Number, default: null, min: 0 },

    state: { type: String, enum: ATTACHMENT_STATES, default: 'pending', index: true },
    /** Set once a message claims this attachment; used by the orphan sweep. */
    attachedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Orphan sweep: pending attachments older than the TTL.
attachmentSchema.index({ state: 1, createdAt: 1 });
// Storage GC / lookup by key without a full scan.
attachmentSchema.index({ storageKey: 1 });

export type AttachmentDoc = InferSchemaType<typeof attachmentSchema>;
export const Attachment = model('Attachment', attachmentSchema);