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
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

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
