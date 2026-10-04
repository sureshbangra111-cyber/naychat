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

  /**
   * Media attachments (Feature: image + voice messages).
   *
   * Everything here is SERVER-SIDE ONLY. No storage credential is ever prefixed
   * VITE_, so Vite cannot inline one into the browser bundle.
   *
   * Architecture: Express -> AttachmentStorage driver -> MongoDB keeps METADATA
   * only (storageKey, mimeType, size, dimensions, duration). Binary payloads
   * never live inside a message document and are never base64-encoded in the
   * database, so a message document stays small and cheap to poll.
   */
  attachments: {
    /** `local` writes to ATTACHMENT_STORAGE_DIR; `s3` is a drop-in later. */
    driver: (process.env.ATTACHMENT_STORAGE_DRIVER ?? 'local').trim().toLowerCase(),
    /** Root directory for the local driver. Never exposed to the browser. */
    storageDir: path.resolve(
      SERVER_ROOT,
      process.env.ATTACHMENT_STORAGE_DIR?.trim() || '../.data/attachments',
    ),
    /** Hard ceiling applied during streaming, independent of any Content-Length. */
    maxImageBytes: Math.round(Number(process.env.IMAGE_MAX_SIZE_MB ?? 10) * 1024 * 1024),
    maxAudioBytes: Math.round(Number(process.env.AUDIO_MAX_SIZE_MB ?? 10) * 1024 * 1024),
    /** Attachments uploaded but never attached to a message are swept after this. */
    orphanTtlMs: Number(process.env.ATTACHMENT_ORPHAN_TTL_MS ?? 60 * 60 * 1000),
    /** How many attachments one conversation may hold (abuse guard). */
    maxPerConversation: Number(process.env.ATTACHMENT_MAX_PER_CONVERSATION ?? 100),
    /** Server-side cap on the caption that may accompany a media message. */
    maxCaptionLength: Number(process.env.ATTACHMENT_MAX_CAPTION_LENGTH ?? 1000),
  },

  /**
   * Meta Ads / Conversions API — SERVER-ONLY SECRETS.
   *
   * `metaConversionsApiAccessToken` is a credential. It is never prefixed VITE_,
   * never stored in MongoDB, never returned by /api/public/config, and never
   * logged. When it is absent, every Conversions API call becomes a no-op, so
   * browser Pixel tracking keeps working on its own.
   *
   * NOTE: the *browser* Pixel ID is NOT configured here. It lives in AppSettings
   * and is edited from Admin Settings, so it can change without a redeploy.
   * `metaPixelIdEnv` below is only a server-side fallback for the Conversions
   * API dataset, for deployments that never touch the admin UI.
   */
  meta: {
    /** Server-only fallback dataset ID for Conversions API. Never sent to the browser. */
    pixelIdFallback: process.env.META_PIXEL_ID?.trim() || '',
    /**
     * Access token for the Meta Conversions API. Secret: server environment only.
     * Never exposed through any endpoint, never persisted, never logged.
     */
    conversionsApiAccessToken: process.env.META_CONVERSIONS_API_ACCESS_TOKEN?.trim() || '',
    /** Graph API version used for Conversions API calls. */
    graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0',
    /** Master kill switch for server-side Conversions API delivery. */
    conversionsApiEnabled:
      (process.env.META_CONVERSIONS_API_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
  },

  /** Seeded on first boot so a fresh database is immediately usable. */
  defaultSettings: {
    companyName: process.env.DEFAULT_COMPANY_NAME ?? 'Support Team',
    welcomeMessage:
      process.env.DEFAULT_WELCOME_MESSAGE ?? 'Hi 👋 How can we help you today?',
  },
} as const;

export type AppConfig = typeof config;
