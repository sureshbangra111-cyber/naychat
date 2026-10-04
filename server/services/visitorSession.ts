/**
 * Anonymous visitor sessions — the replacement for Supabase anonymous sign-in.
 *
 * Flow:
 *   1. Browser has no cookie -> server generates a random token, stores only its
 *      SHA-256 hash against a Visitor document, and sets the raw token as an
 *      HTTP-only cookie.
 *   2. Every later request resolves the Visitor by hashing the cookie value.
 *
 * Because the raw token never leaves the HTTP-only cookie and never appears in a
 * request body, a visitor cannot claim another visitor's id by editing the
 * browser. The browser's own `visitorId` is analytics-only and is ignored for
 * authorisation.
 */

import { Types } from 'mongoose';
import { Visitor } from '../models/Visitor.js';
import { config } from '../config/env.js';
import { randomToken, sha256, shortPublicId } from '../utils/crypto.js';

export interface VisitorSession {
  visitorId: string;
  publicId: string;
}

/** Resolves the Visitor behind a session token, or null when absent/expired. */
export async function resolveVisitor(token: string | null): Promise<VisitorSession | null> {
  if (!token) return null;

  const visitor = await Visitor.findOne({
    sessionTokenHash: sha256(token),
    lastSeenAt: { $gte: new Date(Date.now() - config.session.visitorTtlMs) },
  });

  if (!visitor) return null;

  // Throttle the write: only refresh if the last touch is older than a minute.
  if (Date.now() - visitor.lastSeenAt.getTime() > 60_000) {
    await Visitor.updateOne({ _id: visitor._id }, { $set: { lastSeenAt: new Date() } });
  }

  return { visitorId: visitor._id.toString(), publicId: visitor.publicId };
}

/** Creates a brand-new anonymous visitor session and returns its raw token. */
export async function createVisitorSession(): Promise<{
  session: VisitorSession;
  token: string;
}> {
  const token = randomToken(32);

  const visitor = await Visitor.create({
    sessionTokenHash: sha256(token),
    publicId: shortPublicId(),
  });

  return { session: { visitorId: visitor._id.toString(), publicId: visitor.publicId }, token };
}

/** Ensures a session exists, creating one when the cookie is missing or stale. */
export async function ensureVisitorSession(
  token: string | null,
): Promise<{ session: VisitorSession; token: string; created: boolean }> {
  const existing = await resolveVisitor(token);
  if (existing) {
    return { session: existing, token: token as string, created: false };
  }
  const { session, token: fresh } = await createVisitorSession();
  return { session, token: fresh, created: true };
}

export function toObjectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}
