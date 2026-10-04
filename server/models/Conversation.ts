/**
 * Conversations.
 *
 * Ported from the Supabase `conversations` table. Two deliberate changes:
 *  * `visitorRef` (ObjectId -> visitors) replaces the `session_id` UUID column.
 *    Ownership is now a real foreign key in Mongo, not a text column compared
 *    against a JWT claim.
 *  * `visitorId` (the old browser-supplied text id) is kept for continuity with
 *    the analytics fields but is NEVER used for authorisation.
 */

import { Schema, model, type InferSchemaType } from 'mongoose';

export const CONVERSATION_STATUSES = ['open', 'waiting', 'closed'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

const conversationSchema = new Schema(
  {
    /** Ownership anchor. Every customer query filters on this. */
    visitorRef: {
      type: Schema.Types.ObjectId,
      ref: 'Visitor',
      required: true,
      index: true,
    },

    /** Legacy/browser-supplied id. Informational only — never trusted. */
    visitorId: { type: String, default: null, maxlength: 100 },

    customerName: { type: String, default: null, maxlength: 100 },
    customerPhone: { type: String, default: null, maxlength: 40 },

    status: {
      type: String,
      enum: CONVERSATION_STATUSES,
      default: 'open',
      required: true,
      index: true,
    },

    assignedAdminRef: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },

    // --- UTM / campaign attribution (captured once, at conversation start) ---
    utmSource: { type: String, default: null, maxlength: 100 },
    utmMedium: { type: String, default: null, maxlength: 100 },
    utmCampaign: { type: String, default: null, maxlength: 100, index: true },
    utmTerm: { type: String, default: null, maxlength: 100 },
    utmContent: { type: String, default: null, maxlength: 100 },
    fbclid: { type: String, default: null, maxlength: 200 },
    landingPage: { type: String, default: null, maxlength: 500 },
    referrer: { type: String, default: null, maxlength: 500 },

    lastMessageAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    /** Denormalised unread counter for the inbox "unread" filter. */
    unreadCustomerCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// The inbox sorts by most-recent activity with nulls last; the dashboard filters
// by status and day. These two compound indexes cover the real access patterns.
conversationSchema.index({ status: 1, lastMessageAt: -1 });
conversationSchema.index({ lastMessageAt: -1, createdAt: -1 });
conversationSchema.index({ createdAt: -1 });

export type ConversationDoc = InferSchemaType<typeof conversationSchema>;
export const Conversation = model('Conversation', conversationSchema);

/** Narrow a string to a valid status, defaulting to 'open'. */
export function asConversationStatus(value: unknown): ConversationStatus {
  return CONVERSATION_STATUSES.includes(value as ConversationStatus)
    ? (value as ConversationStatus)
    : 'open';
}
