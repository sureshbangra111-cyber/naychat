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

    /**
     * FIRST-TOUCH advertising attribution.
     *
     * Captured once, the first time a visitor arrives with UTM parameters or a
     * `fbclid`. Two reasons this lives on the Visitor rather than only on the
     * Conversation:
     *   * it survives the visitor starting, closing and re-opening conversations,
     *   * it survives the URL being cleaned up after the first load.
     *
     * `firstAttributionAt` is the guard that makes attribution FIRST-TOUCH: later
     * visits without parameters, or with different ones, never overwrite the
     * original click. Only fields that were previously empty are filled in.
     *
     * These are advertising parameters, not personal data. Nothing here is
     * forwarded to Meta except through the documented Conversions API fields.
     */
    firstAttribution: {
      source: { type: String, default: null, maxlength: 100 },
      medium: { type: String, default: null, maxlength: 100 },
      campaign: { type: String, default: null, maxlength: 100 },
      term: { type: String, default: null, maxlength: 100 },
      content: { type: String, default: null, maxlength: 100 },
      fbclid: { type: String, default: null, maxlength: 200 },
      landingPage: { type: String, default: null, maxlength: 500 },
      referrer: { type: String, default: null, maxlength: 500 },
      capturedAt: { type: Date, default: null },
    },

    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Attribution lookups for aggregate reporting.
visitorSchema.index({ 'firstAttribution.source': 1, 'firstAttribution.campaign': 1 });
visitorSchema.index({ 'firstAttribution.capturedAt': 1 });

export type VisitorDoc = InferSchemaType<typeof visitorSchema>;
export const Visitor = model('Visitor', visitorSchema);
