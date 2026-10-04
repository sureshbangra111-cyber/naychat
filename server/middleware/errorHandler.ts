/**
 * Central error handler.
 *
 * Every failure leaves through here. ApiError messages are safe to show; anything
 * else is logged server-side and replaced with a generic message, so Mongo
 * errors, stack traces and internal ids never reach the browser.
 */

import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../utils/errors.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.publicMessage } });
    return;
  }

  // Duplicate key — surface as a conflict rather than a 500.
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: number }).code === 11000
  ) {
    res.status(409).json({
      error: { code: 'duplicate', message: 'That record already exists.' },
    });
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'invalid_id', message: 'Invalid identifier.' } });
    return;
  }

  // Anything else is a bug or an outage: log it server-side, show nothing specific.
  // eslint-disable-next-line no-console
  console.error('[api] unhandled error:', error);

  res.status(500).json({
    error: { code: 'server_error', message: 'Something went wrong. Please try again.' },
  });
}
