/**
 * Vercel serverless entry.
 *
 * Vercel routes requests to files in /api. This shim re-exports the compiled
 * handler (dist-server/handler.js), which Vercel builds during `npm run build`.
 * Keeping this file as plain committed JS means Vercel never tries to compile
 * TypeScript at request time.
 */
export { default } from '../dist-server/handler.js';
