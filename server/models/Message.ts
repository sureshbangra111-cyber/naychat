/**
 * Messages.
 *
 * Ported from the Supabase `messages` table. `conversationId` is the natural key
 * used by every read (history page and incremental poll), so it is indexed.
 *
 * `senderAdminRef` records WHO replied. The Supabase version stored the admin's
 * auth uid; here it is an ObjectId into `admins`. It is set by the server from
 * the authenticated session, never from the request body.
 */

import { Schema, model, type InferSchemaType } from 'mongoose';

export const SENDER_TYPES = ['customer', 'admin'] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

/**
 * Message kinds. 'text' is the default so every row that predates media support
 * keeps rendering and behaving exactly as before.
 */
export const MESSAGE_TYPES = ['text', 'image', 'audio'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/**
 * Media metadata embedded in a message.
 *
 * Deliberately mirrors the shape the API returns, but with a storageKey that is
 * server-internal: it is never serialised into a DTO, so the browser can only
 * ever address media through the authorised `/api/attachments/:id` route and
 * cannot guess or enumerate storage locations.
 */
const attachmentRefSchema = new Schema(
  {
    attachmentId: { type: Schema.Types.ObjectId, ref: 'Attachment', required: true },
    /** Server-internal. Stripped by toMessageDTO. */
    storageKey: { type: String, required: true, maxlength: 300 },
    mimeType: { type: String, required: true, maxlength: 120 },
    size: { type: Number, required: true, min: 0 },
    originalName: { type: String, default: null, maxlength: 150 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationMs: { type: Number, default: null },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderType: { type: String, enum: SENDER_TYPES, required: true },
    /** Set only for admin messages. Server-derived from the session. */
    senderAdminRef: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    /**
     * Message body.
     *
     * NOT required any more: an image or a voice note is a valid message on its
     * own and its `text` is then the empty string. Existing text messages are
     * completely unaffected — they keep the same field, the same requiredness in
     * practice (the service layer still refuses an empty text-only message), and
     * the same DTO.
     */
    message: { type: String, default: '', maxlength: 5000 },

    /**
     * 'text' (default, so every pre-existing row reads as a text message) |
     * 'image' | 'audio'.
     */
    type: {
      type: String,
      enum: MESSAGE_TYPES,
      default: 'text',
      required: true,
    },

    /**
     * Media metadata for image/audio messages. Embedded by ID rather than
     * duplicated so the single source of truth stays in `attachments`, and the
     * message document remains small.
     *
     * The resolved fields (mimeType, size, width/height, durationMs, originalName)
     * ARE snapshotted here so rendering a bubble — and the conversation list —
     * never needs an extra query per message. Authorisation always re-reads the
     * Attachment document, never this snapshot.
     */
    attachment: { type: attachmentRefSchema, default: null },

    readAt: { type: Date, default: null },
    attachmentUrl: { type: String, default: null, maxlength: 1000 },
    attachmentType: { type: String, default: null, maxlength: 100 },
    /**
     * Client-generated idempotency key. The unique partial index below is the
     * database-level guarantee that one client_id yields at most one message —
     * the same race protection the Supabase version relied on.
     */
    clientId: { type: String, default: null, maxlength: 100 },
  },
  { timestamps: true },
);

// History page + "newer than X" poll, both scoped to one conversation.
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, createdAt: 1, _id: 1 });
// Admin dashboard unread count.
messageSchema.index({ senderType: 1, readAt: 1 });
// Sparse (not partial) unique index so admin replies without a clientId are
// unaffected while duplicate customer retries are rejected.
messageSchema.index(
  { conversationId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
);

export type MessageDoc = InferSchemaType<typeof messageSchema>;
export const Message = model('Message', messageSchema);
