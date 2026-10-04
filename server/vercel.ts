/**
 * Vercel serverless entry point.
 *
 * Vercel does NOT run a long-lived listening process: each invocation imports
 * this file and calls the exported handler with (req, res). That is a different
 * contract from `npm run serve`, which calls `app.listen()` — so we export the
 * Express app itself rather than a server.
 *
 * `vercel.json` points its build at the compiled version of this file
 * (`dist-server/vercel.js`) and includes `dist/` via `includeFiles` so the
 * built frontend is available to `express.static` at runtime.
 */

import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';

const app = createApp();

/**
 * The connection promise is created once per cold start and awaited on the
 * first request, so the first invocation is not served before MongoDB is ready.
 */
let ready: Promise<unknown> | null = null;

async function handler(req: unknown, res: unknown): Promise<void> {
  if (!ready) {
    ready = connectDatabase().catch((error) => {
      // Allow a later invocation to retry rather than caching the failure.
      ready = null;
      throw error;
    });
  }
  await ready;
  (app as unknown as (rq: unknown, rs: unknown) => unknown)(req, res);
}

// @vercel/node calls `default(request, response)`.
export default handler;

