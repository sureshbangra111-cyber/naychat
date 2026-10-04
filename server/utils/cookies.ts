/**
 * Cookie helpers.
 *
 * Both session types use HTTP-only cookies so neither the visitor token nor the
 * admin session id is reachable from JavaScript — a stored-XSS bug cannot steal
 * a session.
 */

import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config/env.js';

/**
 * `Secure` cookies are only sent over HTTPS.
 *
 * Blanking `secure` on the NODE_ENV check alone is a trap: running the app
 * locally over plain HTTP would set a Secure cookie that the browser silently
 * drops, so admin login would return 200 and every later request would 401.
 * We therefore require BOTH production mode AND a secure request (TLS, or
 * x-forwarded-proto from a TLS-terminating proxy) before marking Secure.
 */
function isHttpsRequest(req: { secure?: boolean; protocol?: string }): boolean {
  return Boolean(req.secure) || req.protocol === 'https';
}

function baseOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    // `lax` still sends the cookie on top-level navigation (so a reload keeps the
    // session) while blocking it on cross-site POSTs — this is what protects the
    // admin session from CSRF without needing token headers.
    sameSite: 'lax',
    secure: config.isProduction && isHttpsRequest(req),
    path: '/',
  };
}

export function setVisitorCookie(req: Request, res: Response, token: string): void {
  res.cookie(
    config.session.cookieName,
    token,
    { ...baseOptions(req), maxAge: config.session.visitorTtlMs },
  );
}

export function setAdminCookie(req: Request, res: Response, token: string): void {
  res.cookie('chat_admin_sid', token, {
    ...baseOptions(req),
    maxAge: config.session.adminTtlMs,
  });
}

export function clearAdminCookie(req: Request, res: Response): void {
  res.clearCookie('chat_admin_sid', baseOptions(req));
}

export function readSessionToken(req: { cookies?: Record<string, string> }): string | null {
  const raw = req.cookies?.[config.session.cookieName];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function readAdminToken(req: { cookies?: Record<string, string> }): string | null {
  const raw = req.cookies?.chat_admin_sid;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
