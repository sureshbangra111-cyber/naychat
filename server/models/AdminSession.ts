/**
 * Admin sessions (server-side, cookie-backed).
 *
 * Replaces the Supabase Auth session. Only a SHA-256 hash of the session token
 * is stored, so a database leak cannot be replayed as a live admin session.
 *
 * Sessions are persisted rather than kept in memory so a server restart does not
 * log every admin out, and so expiry can be enforced by the database.
 */

import { Schema, model, type InferSchemaType } from 'mongoose';

const adminSessionSchema = new Schema(
  {
    adminRef: { type: Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    // No `index: true` here — the TTL index below covers it (declaring both
    // makes Mongoose skip the TTL options, silently disabling expiry cleanup).
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: null, maxlength: 300 },
    ip: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: true },
);

// TTL index: MongoDB removes expired sessions automatically.
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AdminSessionDoc = InferSchemaType<typeof adminSessionSchema>;
export const AdminSession = model('AdminSession', adminSessionSchema);
