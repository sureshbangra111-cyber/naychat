/**
 * Server configuration.
 *
 * Every value here is SERVER-SIDE ONLY. None of it is ever bundled into the
 * browser: the frontend only ever talks to `/api/*` over HTTP.
 *
 * `.env` is read from the repository root so a single file configures both the
 * Vite build and the API. `server/.env` is also honoured for deployments that
 * keep backend secrets separate.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Locate the project root reliably for BOTH run modes:
 *   - from source:   <root>/server/config/env.ts
 *   - compiled:      <root>/dist-server/config/env.js
 *
 * Both are two levels below the root, so a fixed `../..` is correct either way.
 * We then confirm it really is the root (it must contain package.json) and fall
 * back to the working directory otherwise. Deriving the `.env` location from a
 * "server root" variable instead was the bug: when compiled, that variable
 * pointed at dist-server/ and server/.env was never found.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function isProjectRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'package.json'));
}

function resolveProjectRoot(): string {
  const candidates = [path.resolve(moduleDir, '..', '..'), process.cwd()];
  for (const candidate of candidates) {
    if (isProjectRoot(candidate)) return candidate;
  }
  // Nothing looked like a root; the module-relative guess is still the best guess.
  return path.resolve(moduleDir, '..', '..');
}

export const PROJECT_ROOT = resolveProjectRoot();

/** Root of the TypeScript server sources (present in the repo, not in dist-server). */
export const SERVER_ROOT = path.join(PROJECT_ROOT, 'server');

// Load `<root>/.env` then `<root>/server/.env` — the later file wins, so a
// deployment can keep backend secrets in server/.env while the shared one holds
// frontend config.
for (const envPath of [
  path.join(PROJECT_ROOT, '.env'),
  path.join(PROJECT_ROOT, 'server', '.env'),
]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. See server/.env.example.`,
    );
  }
  return value.trim();
}

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 4000),

  /**
   * MongoDB connection string. There is deliberately NO default and no fallback:
   * a wrong default would silently point at nothing and look like a working app.
   */
  mongoUri: required('MONGODB_URI'),
  mongoDb: process.env.MONGODB_DB?.trim() || 'support_chat',

  /** Used to sign the session cookie id so a stolen cookie cannot be replayed. */
  sessionSecret: required('SESSION_SECRET'),

  /** Origins allowed to call the API with credentials. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5176')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  session: {
    cookieName: process.env.SESSION_COOKIE_NAME?.trim() || 'chat_sid',
    /** Anonymous visitor session lifetime (30 days). */
    visitorTtlMs: Number(process.env.VISITOR_SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000),
    /** Admin session lifetime (8 hours) — deliberately short. */
    adminTtlMs: Number(process.env.ADMIN_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000),
  },

  /** Abuse limits, ported from the previous RPC business rules. */
  limits: {
    maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH ?? 4000),
    /** Server-side hard cap; the UI's softer limit is MAX_MESSAGE_LENGTH. */
    hardMessageLength: 5000,
    maxConversationsPerVisitor: Number(process.env.MAX_CONVERSATIONS_PER_VISITOR ?? 25),
  },

  /** Seeded on first boot so a fresh database is immediately usable. */
  defaultSettings: {
    companyName: process.env.DEFAULT_COMPANY_NAME ?? 'Support Team',
    welcomeMessage:
      process.env.DEFAULT_WELCOME_MESSAGE ?? 'Hi 👋 How can we help you today?',
  },
} as const;

export type AppConfig = typeof config;
