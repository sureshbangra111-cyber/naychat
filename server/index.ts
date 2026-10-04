/** Server entry point. */

import { createApp } from './app.js';
import { config, PROJECT_ROOT } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { sweepOrphanAttachments } from './services/attachments/service.js';
import { getAttachmentStorage } from './services/attachments/storage.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Periodic orphan sweep.
 *
 * An upload whose message was never created leaves a stored object plus a
 * `pending` row. Those are cleaned on two triggers:
 *   * this interval, for the normal "user picked a file then abandoned it" case,
 *   * inline in the upload path, for a database failure between storing bytes
 *     and writing the row.
 *
 * The sweep is unref'd so it never keeps the process alive on shutdown.
 */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function startOrphanSweeper(): NodeJS.Timeout {
  const run = async () => {
    try {
      const result = await sweepOrphanAttachments();
      if (result.rowsDeleted > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[attachments] orphan sweep removed ${result.rowsDeleted} metadata row(s) and ${result.filesDeleted} stored file(s)`,
        );
      }
    } catch (error) {
      // A failed cleanup must never take the API down.
      // eslint-disable-next-line no-console
      console.error('[attachments] orphan sweep failed:', error instanceof Error ? error.message : error);
    }
  };

  // One pass shortly after boot, then on the interval.
  const initial = setTimeout(() => void run(), 15_000);
  initial.unref();

  const timer = setInterval(() => void run(), SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

async function main(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(config.port, () => {
    const hasBuild = fs.existsSync(path.join(PROJECT_ROOT, 'dist', 'index.html'));
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(
      hasBuild
        ? `[web] serving built frontend from dist/ — open http://localhost:${config.port}/chat`
        : '[web] no dist/ build found — run `npm run build` to serve the frontend from this process',
    );
    try {
      // Creating the driver here surfaces a misconfigured ATTACHMENT_STORAGE_DIR
      // at boot rather than on the first upload.
      getAttachmentStorage();
      // eslint-disable-next-line no-console
      console.log(
        `[attachments] storage driver "${config.attachments.driver}" ready (image max ${Math.round(
          config.attachments.maxImageBytes / 1024 / 1024,
        )}MB, audio max ${Math.round(config.attachments.maxAudioBytes / 1024 / 1024)}MB)`,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[attachments] storage unavailable:', error instanceof Error ? error.message : error);
    }
  });

  const sweeper = startOrphanSweeper();

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[api] ${signal} received, shutting down`);
    clearInterval(sweeper);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[api] failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
