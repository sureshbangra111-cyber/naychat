/**
 * Admin authentication — the replacement for Supabase Auth.
 *
 * Differences from the old flow, all of them security improvements:
 *  * passwords are verified against a bcrypt hash stored in Mongo (previously
 *    Supabase owned the credentials and we never saw them);
 *  * the session is a server-side record referenced by an HTTP-only cookie, so
 *    logout is a real revocation rather than a client-side token delete;
 *  * only the SHA-256 hash of the session token is persisted.
 */

import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { Admin } from '../models/Admin.js';
import { AdminSession } from '../models/AdminSession.js';
import { config } from '../config/env.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { unauthorized } from '../utils/errors.js';
import { cleanEmail } from '../utils/validate.js';

export interface AdminDTO {
  id: string;
  email: string;
  full_name: string | null;
  role: 'owner' | 'agent';
  created_at: string;
}

export function toAdminDTO(admin: {
  _id: Types.ObjectId;
  email: string;
  fullName?: string | null;
  role: string;
  createdAt?: Date;
}): AdminDTO {
  return {
    id: admin._id.toString(),
    email: admin.email,
    // `full_name` keeps the existing frontend contract (snake_case DTO) so no
    // component had to change.
    full_name: admin.fullName ?? null,
    role: admin.role === 'owner' ? 'owner' : 'agent',
    created_at: (admin.createdAt ?? new Date()).toISOString(),
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

/**
 * Verifies credentials. Always runs a bcrypt comparison, even when the email is
 * unknown, so response timing does not reveal which accounts exist.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ admin: AdminDTO; token: string } | null> {
  const normalisedEmail = cleanEmail(email);
  const admin = await Admin.findOne({ email: normalisedEmail, active: true });

  if (!admin) {
    // Dummy compare to equalise timing.
    await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu');
    return null;
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return null;

  await Admin.updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });

  const token = randomToken(32);
  await AdminSession.create({
    adminRef: admin._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + config.session.adminTtlMs),
  });

  return { admin: toAdminDTO(admin), token };
}

/** Resolves an admin session cookie to an admin, or null. Expired = null. */
export async function resolveAdminSession(token: string | null): Promise<AdminDTO | null> {
  if (!token) return null;

  const session = await AdminSession.findOne({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;

  const admin = await Admin.findById(session.adminRef);
  if (!admin || !admin.active) return null;

  return toAdminDTO(admin);
}

/** Revokes a single session (logout). */
export async function destroyAdminSession(token: string | null): Promise<void> {
  if (!token) return;
  await AdminSession.deleteOne({ tokenHash: sha256(token) });
}

export function assertAdmin(auth: AdminDTO | null): AdminDTO {
  if (!auth) throw unauthorized('Admin sign-in required.', 'admin_unauthorized');
  return auth;
}
