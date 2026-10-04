/**
 * Admin bootstrap: `npm run create-admin`
 *
 * Reads ADMIN_EMAIL plus EITHER ADMIN_PASSWORD (hashed here, never stored) or
 * ADMIN_PASSWORD_HASH (used as-is) from the SERVER environment, then upserts the
 * admin. The plaintext password is never written to MongoDB and never printed.
 *
 * Refuses to run when neither is present rather than inventing a default.
 */

import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Admin } from '../models/Admin.js';
import { hashPassword } from '../services/adminAuth.js';
import { cleanEmail } from '../utils/validate.js';

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/;

async function main(): Promise<void> {
  const rawEmail = process.env.ADMIN_EMAIL?.trim();
  const plainPassword = process.env.ADMIN_PASSWORD;
  const providedHash = process.env.ADMIN_PASSWORD_HASH?.trim();

  if (!rawEmail) {
    throw new Error('ADMIN_EMAIL is not set. Add it to your server .env and re-run.');
  }
  if (!plainPassword && !providedHash) {
    throw new Error(
      'Set either ADMIN_PASSWORD (it will be hashed) or ADMIN_PASSWORD_HASH in your server .env, then re-run.',
    );
  }

  if (providedHash && !BCRYPT_RE.test(providedHash)) {
    throw new Error('ADMIN_PASSWORD_HASH does not look like a bcrypt hash.');
  }
  if (plainPassword && plainPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  }

  const email = cleanEmail(rawEmail);
  const passwordHash = providedHash ?? (await hashPassword(plainPassword as string));

  await connectDatabase();

  const role = (process.env.ADMIN_ROLE?.trim() || 'owner') as 'owner' | 'agent';
  const fullName = process.env.ADMIN_FULL_NAME?.trim() || null;

  const admin = await Admin.findOneAndUpdate(
    { email },
    { $set: { passwordHash, role, fullName, active: true } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  // Deliberately echoes NO secret — not the password, not the hash.
  // eslint-disable-next-line no-console
  console.log(`[create-admin] admin ready: ${admin.email} (role: ${admin.role}, id: ${admin._id})`);

  await disconnectDatabase();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('[create-admin] failed:', error instanceof Error ? error.message : error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
