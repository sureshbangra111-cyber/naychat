/**
 * Anonymous visitor sessions.
 *
 * This is the server-side replacement for the Supabase anonymous Auth user. The
 * old design anchored RLS on `auth.uid()`; here the anchor is a random
 * `sessionToken` that exists ONLY inside an HTTP-only cookie.
 *
 * The browser never supplies its own visitor id for authorisation — it sends a
 * cookie and the server resolves the Visitor. That is what stops visitor A from
 * reading visitor B's conversation.
 */

import { Schema, model, type InferSchemaType } from 'mongoose';

const visitorSchema = new Schema(
  {
    /**
     * Random 256-bit value, generated server-side. Stored so the raw cookie
     * value never has to be trusted from the request body.
     */
    sessionTokenHash: { type: String, required: true, unique: true, index: true },

    /** Short public id, useful for support/debugging only — NOT an auth token. */
    publicId: { type: String, required: true, unique: true, index: true },

    /** Denormalised counters so abuse limits need no conversation scan. */
    conversationCount: { type: Number, default: 0, min: 0 },

    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type VisitorDoc = InferSchemaType<typeof visitorSchema>;
export const Visitor = model('Visitor', visitorSchema);
