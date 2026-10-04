/**
 * Local visitor session helpers.
 *
 * Two identifiers are kept, and only ONE of them matters for security:
 *   * `anonymous_visitor_id` — a browser-local UUID used for analytics/debugging
 *     only. The server NEVER authorises on it.
 *   * the server session cookie — an httpOnly cookie the JavaScript cannot even
 *     read. It is the actual authorisation anchor, resolved server-side to a
 *     Visitor record. This replaces the old Supabase anonymous-auth session.
 *
 * No passwords or secrets are stored in localStorage.
 */

import { apiRequest } from './api';

const VISITOR_KEY = 'anonymous_visitor_id';
const ACTIVE_CONVERSATION_KEY = 'active_conversation_id';

/** RFC-4122 v4 UUID using the Web Crypto API when available. */
export function generateUuid(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');
  }
  // Last-resort fallback (never hit on modern browsers).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage disabled (private mode) — chat still works for this page view */
  }
}

function removeItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Stable per-device visitor UUID. Generated once, then reused. Analytics only. */
export function getVisitorId(): string {
  const existing = readItem(VISITOR_KEY);
  if (existing && existing.length >= 8) return existing;
  const generated = generateUuid();
  writeItem(VISITOR_KEY, generated);
  return generated;
}

export function getActiveConversationId(): string | null {
  return readItem(ACTIVE_CONVERSATION_KEY);
}

export function setActiveConversationId(id: string | null): void {
  if (id) writeItem(ACTIVE_CONVERSATION_KEY, id);
  else removeItem(ACTIVE_CONVERSATION_KEY);
}

/**
 * Ensures the server-side anonymous visitor session exists.
 *
 * This is invisible to the customer — no email, no password, no form. The server
 * sets an httpOnly cookie on first call, and every later request is authorised
 * from that cookie rather than from anything the page can read or forge.
 */
export async function ensureAnonymousSession(): Promise<string> {
  const data = await apiRequest<{ visitor_id: string }>('/session');
  return data.visitor_id;
}
