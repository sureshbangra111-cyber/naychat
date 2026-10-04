/**
 * Request authentication middleware.
 *
 * `attachVisitor`  — resolves the anonymous visitor from the HTTP-only cookie and
 *                    creates one when absent. Customers are never asked to log in.
 * `requireVisitor`  — 401s if there is no visitor session (so a caller can never
 *                    act without one).
 * `requireAdmin`    — 401s unless a valid, unexpired admin session cookie is
 *                    present. This is the ONLY admin gate; the frontend guard is
 *                    cosmetic.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  ensureVisitorSession,
  resolveVisitor,
  type VisitorSession,
} from '../services/visitorSession.js';
import { resolveAdminSession, type AdminDTO } from '../services/adminAuth.js';
import { readSessionToken, readAdminToken, setVisitorCookie } from '../utils/cookies.js';
import { unauthorized } from '../utils/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      visitor?: VisitorSession;
      admin?: AdminDTO;
    }
  }
}

/** Always resolves a visitor, creating a session when the cookie is absent. */
export async function attachVisitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readSessionToken(req);
    const existing = await resolveVisitor(token);

    if (existing) {
      req.visitor = existing;
      next();
      return;
    }

    const { session, token: fresh } = await ensureVisitorSession(token);
    setVisitorCookie(req, res, fresh);
    req.visitor = session;
    next();
  } catch (error) {
    next(error);
  }
}

/** Requires a visitor session to already exist on the request. */
export function requireVisitor(req: Request, _res: Response, next: NextFunction): void {
  if (!req.visitor) {
    next(unauthorized('Your chat session has expired. Please reload the page.', 'visitor_required'));
    return;
  }
  next();
}

/** Resolves the admin when a session cookie exists. Never rejects on its own. */
export async function attachAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = await resolveAdminSession(readAdminToken(req));
    if (admin) req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
}

/** Gate for every /api/admin/* route. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.admin) {
    next(unauthorized('Admin sign-in required.', 'admin_unauthorized'));
    return;
  }
  next();
}
