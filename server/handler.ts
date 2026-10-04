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
 * One connection attempt per cold start, shared by every request.
 * Reset on failure so a later invocation can retry.
 */
let ready: Promise<unknown> | null = null;

async function handler(req: unknown, res: unknown): Promise<void> {
  try {
    if (!ready) {
      ready = connectDatabase().catch((error) => {
        ready = null;
        throw error;
      });
    }
    await ready;
  } catch (error) {
    // Do NOT rethrow: letting this bubble aborts the whole serverless
    // invocation and Vercel reports an opaque FUNCTION_INVOCATION_FAILED with
    // no body. Continuing lets the app answer /api/health with a real reason
    // and lets request handlers surface a normal 5xx JSON error instead.
    console.error(
      '[db] connection failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  (app as unknown as (rq: unknown, rs: unknown) => unknown)(req, res);
}

export default handler;
