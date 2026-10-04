/**
 * Express application.
 *
 * Note what is NOT here: no database credentials, no session secret, no admin
 * password reaches the browser. The API only ever sends JSON + httpOnly cookies.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { config, PROJECT_ROOT } from './config/env.js';
import { customerRouter } from './controllers/customer.js';
import { adminRouter } from './controllers/admin.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { isDatabaseConnected } from './config/db.js';

/** Where `npm run build` writes the frontend bundle. */
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

export function createApp() {
  const app = express();

  // Behind a reverse proxy (Render/Railway/Fly/nginx) this makes req.ip and
  // `secure` cookies behave correctly.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and curl requests have no Origin header.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser(config.sessionSecret));

  // Baseline abuse protection for the whole API.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' },
      },
    }),
  );

  // Basic hardening headers. No Helmet dependency needed for this small surface.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: isDatabaseConnected(),
      database: isDatabaseConnected() ? 'connected' : 'disconnected',
    });
  });

  app.use('/api', customerRouter);
  app.use('/api/admin', adminRouter);

  // ===========================================================================
  // FRONTEND (built bundle)
  // ===========================================================================
  // One Node process serves both the API and the compiled React app, so a
  // deployment is a single artifact. Same-origin also means the httpOnly session
  // cookies are first-party — no CORS, no cross-site cookie issues.
  //
  // ORDER MATTERS: everything API-related is registered above, so these
  // handlers can only ever see non-API paths.

  const hasBuild = fs.existsSync(path.join(DIST_DIR, 'index.html'));

  if (hasBuild) {
    // Hashed asset filenames (index-a1b2c3.js) are safe to cache forever.
    app.use(
      '/assets',
      express.static(path.join(DIST_DIR, 'assets'), {
        immutable: true,
        maxAge: '1y',
        fallthrough: true,
      }),
    );

    // Public root files (favicon.svg, robots.txt…).
    app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));

    // SPA deep links: /chat, /chat/:id and /admin/login must all return
    // index.html so React Router can resolve them on a hard refresh.
    // `root` keeps the path relative and avoids send() treating a leading
    // slash as an absolute filesystem path.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root: DIST_DIR });
    });
  } else {
    // A clear message beats a confusing 404 when someone forgets to build.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res
        .status(503)
        .type('text/plain')
        .send(
          'Frontend build not found.\n\nRun `npm run build` before starting the server, or use `npm run dev` for development.\nThe API is available under /api.',
        );
    });
  }

  // Only reachable for genuinely unknown /api paths, now that the SPA
  // fallback has taken every non-API route.
  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
