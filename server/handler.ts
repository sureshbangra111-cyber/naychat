/**
 * Serverless request handler.
 *
 * Serverless platforms (Vercel) do NOT run a long-lived listening process:
 * each invocation imports this module and calls the exported handler with
 * (req, res). That is a different contract from `npm run serve`, which calls
 * `app.listen()`, so we export the Express app as a function instead.
 *
 * Deliberately NOT named `vercel.ts`: Vercel auto-detects files with that name
 * and compiles them on its own, ignoring the entry configured in vercel.json.
 *
 * vercel.json points its build at the compiled output
 * (`dist-server/handler.js`) and ships `dist/` via includeFiles so the built
 * frontend is available to express.static at runtime.
 */

import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';

const app = createApp();

/**
 * The connection promise is created once per cold start and awaited before the
 * first request is served, so no request is handled before MongoDB is ready.
 */
let ready: Promise<unknown> | null = null;

async function handler(req: unknown, res: unknown): Promise<void> {
  if (!ready) {
    ready = connectDatabase().catch((error) => {
      // Clear the cached failure so a later invocation can retry.
      ready = null;
      throw error;
    });
  }
  await ready;
  (app as unknown as (rq: unknown, rs: unknown) => unknown)(req, res);
}

export default handler;
