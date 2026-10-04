/** Server entry point. */

import { createApp } from './app.js';
import { config, PROJECT_ROOT } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import fs from 'node:fs';
import path from 'node:path';

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
  });

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[api] ${signal} received, shutting down`);
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
