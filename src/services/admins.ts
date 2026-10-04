/** Admin-only data access, now backed by the Express API. */

import { apiRequest } from '../lib/api';
import type {
  AdminConversationSummary,
  CampaignStats,
  ConversationFilter,
  DashboardStats,
} from '../types/chat';
import { asNumber, asString, isRecord, toNumber } from '../types/database';
import type { AdminConversationPage } from '../types/database';

function toSummary(row: Record<string, unknown>): AdminConversationSummary {
  return {
    id: String(row.id),
    visitor_id: String(row.visitor_id ?? ''),
    customer_name: (row.customer_name as string | null) ?? null,
    customer_phone: (row.customer_phone as string | null) ?? null,
    status: row.status === 'waiting' || row.status === 'closed' ? row.status : 'open',
    assigned_admin_id: (row.assigned_admin_id as string | null) ?? null,
    utm_source: (row.utm_source as string | null) ?? null,
    utm_medium: (row.utm_medium as string | null) ?? null,
    utm_campaign: (row.utm_campaign as string | null) ?? null,
    utm_term: (row.utm_term as string | null) ?? null,
    utm_content: (row.utm_content as string | null) ?? null,
    fbclid: (row.fbclid as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    last_message_at: (row.last_message_at as string | null) ?? null,
    last_message: typeof row.last_message === 'string' ? row.last_message : null,
    unread_count: toNumber(row.unread_count, 0),
  };
}

/** Paginated, filterable, searchable inbox. */
export async function fetchConversationsForAdmin(params: {
  filter: ConversationFilter;
  search: string;
  campaign: string | null;
  limit: number;
  offset: number;
}): Promise<AdminConversationPage> {
  const query = new URLSearchParams({
    filter: params.filter,
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.search.trim()) query.set('search', params.search.trim());
  if (params.campaign) query.set('campaign', params.campaign);

  try {
    const data = await apiRequest<Record<string, unknown>>(`/admin/conversations?${query}`);
    const rows = Array.isArray(data.rows) ? data.rows.filter(isRecord) : [];
    return { rows: rows.map(toSummary), count: toNumber(data.count, 0) };
  } catch (error) {
    return {
      rows: [],
      count: 0,
      error: error instanceof Error ? error.message : 'Could not load conversations.',
    };
  }
}

/** Single conversation for the admin detail view. */
export async function fetchConversationForAdmin(
  id: string,
): Promise<AdminConversationSummary | null> {
  try {
    const data = await apiRequest<{ conversation: Record<string, unknown> }>(
      `/admin/conversations/${id}`,
    );
    return isRecord(data.conversation) ? toSummary(data.conversation) : null;
  } catch {
    return null;
  }
}

export async function fetchDashboardStats(): Promise<DashboardStats | null> {
  try {
    const data = await apiRequest<Record<string, unknown>>('/admin/stats');
    const stats = isRecord(data.stats) ? data.stats : {};
    return {
      total: asNumber(stats.total),
      open: asNumber(stats.open),
      waiting: asNumber(stats.waiting),
      closed: asNumber(stats.closed),
      today: asNumber(stats.today),
      unread: asNumber(stats.unread),
    };
  } catch {
    return null;
  }
}

export async function fetchCampaignStats(): Promise<CampaignStats | null> {
  try {
    const data = await apiRequest<Record<string, unknown>>('/admin/stats');
    const byCampaign = Array.isArray(data.by_campaign) ? data.by_campaign : [];
    const bySource = Array.isArray(data.by_source) ? data.by_source : [];

    return {
      by_campaign: byCampaign.filter(isRecord).map((row) => ({
        campaign: asString(row.campaign, 'No campaign'),
        count: toNumber(row.count),
      })),
      by_source: bySource.filter(isRecord).map((row) => ({
        source: asString(row.source, 'Direct'),
        count: toNumber(row.count),
      })),
    };
  } catch {
    return null;
  }
}

export async function fetchCampaignNames(): Promise<string[]> {
  try {
    const data = await apiRequest<{ campaigns: unknown }>('/admin/campaigns');
    return Array.isArray(data.campaigns)
      ? data.campaigns.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
