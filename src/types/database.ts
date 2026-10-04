/**
 * Row shapes as they come back from the Express API.
 *
 * There is intentionally no generated `Database` generic: hand-maintaining one
 * tends to leak `any` at the call sites anyway. Instead every service narrows
 * its response into a domain type from `types/chat.ts` through the helpers
 * below, so components never touch an untyped row.
 */

import type {
  AdminConversationSummary,
  AppSettings,
  Conversation,
  DashboardStats,
  Message,
} from './chat';

export type ConversationRow = Conversation;
export type MessageRow = Message;
export type AppSettingsRow = AppSettings;

export type AdminConversationSummaryRow = AdminConversationSummary;
export type DashboardStatsRow = DashboardStats;

/** JSON returned by `GET /api/admin/conversations`. */
export interface AdminConversationPage {
  rows: AdminConversationSummary[];
  count: number;
  /** Set when the query failed; the list then renders an error state. */
  error?: string;
}

/** Narrowing helpers — one place to validate untrusted JSON from the DB. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asNullableNumber(value: unknown, fallback = 0): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function asStatus(value: unknown): 'open' | 'waiting' | 'closed' {
  return value === 'waiting' || value === 'closed' ? value : 'open';
}