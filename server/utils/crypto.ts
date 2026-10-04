/**
 * Cryptographic helpers.
 *
 * Session tokens are random 256-bit values; only their SHA-256 hash is stored.
 * The hash lookup is what makes a stolen database dump useless for login.
 */

import crypto from 'node:crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Short public identifier for support/debugging. Not an auth token. */
export function shortPublicId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** Constant-time string comparison, safe for comparing secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
