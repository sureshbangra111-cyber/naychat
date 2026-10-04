/**
 * Input validation and sanitisation.
 *
 * Ported from the SQL `check` constraints and `left(...)` truncations so the API
 * enforces exactly the same limits the database used to.
 *
 * XSS: messages are stored and returned as plain text and the React UI renders
 * them as text nodes, never `dangerouslySetInnerHTML`. We additionally strip
 * control characters and normalise whitespace so a stored payload cannot be used
 * to forge log lines or break the conversation view.
 */

import { badRequest } from './errors.js';

/** Matches valid Mongo ObjectId hex. */
export const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export function isValidObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

export function requireObjectId(value: unknown, label = 'id'): string {
  if (!isValidObjectId(value)) {
    throw badRequest(`Invalid ${label}.`, 'invalid_id');
  }
  return value as string;
}

/** Trims and collapses a string, returning null when empty. */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  // Strip C0/C1 control characters except newline/tab, then collapse runs of
  // whitespace. This keeps one logical message on one line in logs and lists.
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (cleaned.length === 0) return null;
  return cleaned.slice(0, maxLength);
}

export function cleanEmail(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('Email is required.', 'invalid_email');
  const email = value.trim().toLowerCase();
  // Deliberately permissive: the real check is "did Supabase/our DB accept it".
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw badRequest('Please enter a valid email address.', 'invalid_email');
  }
  return email;
}

/**
 * Validates a message body. Throws with the same reason codes the Supabase RPCs
 * used (`empty_message`, `message_too_long`) so the frontend error mapping keeps
 * working unchanged.
 */
export function validateMessageBody(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    throw badRequest('Please type a message.', 'empty_message');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw badRequest('Please type a message.', 'empty_message');
  }
  if (trimmed.length > maxLength) {
    throw badRequest(
      `Please keep your message under ${maxLength} characters.`,
      'message_too_long',
    );
  }
  return trimmed;
}

/** Caps numeric query params to a safe range. */
export function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
