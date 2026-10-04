/**
 * Audit trail + tags, ported from the Supabase `conversation_events` and
 * `conversation_tags` tables.
 *
 * Tags become an embedded array rather than a join table: a conversation has a
 * handful of labels at most, they are always read with the conversation, and
 * embedding removes a round-trip. `conversation_tags` was admin-read-only, so
 * there is no customer write path to protect.
 */

import { Schema, model, type InferSchemaType } from 'mongoose';

export const ACTOR_TYPES = ['customer', 'admin', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

const conversationEventSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    actorRef: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    actorType: { type: String, enum: ACTOR_TYPES, default: 'system', required: true },
    eventType: { type: String, required: true, maxlength: 100 },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

conversationEventSchema.index({ conversationId: 1, createdAt: -1 });

export type ConversationEventDoc = InferSchemaType<typeof conversationEventSchema>;
export const ConversationEvent = model('ConversationEvent', conversationEventSchema);

const conversationTagSchema = new Schema({
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },
  tag: { type: String, required: true, trim: true, lowercase: true, maxlength: 50 },
  createdAt: { type: Date, default: Date.now },
});

// Supports the admin "list conversations carrying tag X" filter.
conversationTagSchema.index({ conversationId: 1, tag: 1 }, { unique: true });

export type ConversationTagDoc = InferSchemaType<typeof conversationTagSchema>;
export const ConversationTag = model('ConversationTag', conversationTagSchema);
