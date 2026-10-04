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
    message: { type: String, required: true, maxlength: 5000 },
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
