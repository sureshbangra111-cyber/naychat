/** Conversation data access, now backed by the Express API. */

import { apiRequest } from '../lib/api';
import type {
  AppSettings,
  CampaignParams,
  Conversation,
  ConversationStatus,
} from '../types/chat';
import { asStatus } from '../types/database';

export const DEFAULT_SETTINGS: AppSettings = {
  company_name: 'Support Team',
  welcome_message: 'Hi 👋 How can we help you today?',
  chat_enabled: true,
};

function toConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    visitor_id: String(row.visitor_id ?? ''),
    session_id: (row.session_id as string | null) ?? null,
    customer_name: (row.customer_name as string | null) ?? null,
    customer_phone: (row.customer_phone as string | null) ?? null,
    status: asStatus(row.status),
    assigned_admin_id: (row.assigned_admin_id as string | null) ?? null,
    utm_source: (row.utm_source as string | null) ?? null,
    utm_medium: (row.utm_medium as string | null) ?? null,
    utm_campaign: (row.utm_campaign as string | null) ?? null,
    utm_term: (row.utm_term as string | null) ?? null,
    utm_content: (row.utm_content as string | null) ?? null,
    fbclid: (row.fbclid as string | null) ?? null,
    landing_page: (row.landing_page as string | null) ?? null,
    referrer: (row.referrer as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_message_at: (row.last_message_at as string | null) ?? null,
    closed_at: (row.closed_at as string | null) ?? null,
  };
}

/** Publicly readable chat configuration. */
export async function fetchSettings(): Promise<AppSettings> {
  try {
    const data = await apiRequest<Record<string, unknown>>('/settings');
    return {
      company_name: String(data.company_name ?? DEFAULT_SETTINGS.company_name),
      welcome_message: String(data.welcome_message ?? DEFAULT_SETTINGS.welcome_message),
      chat_enabled: data.chat_enabled !== false,
    };
  } catch {
    // The chat still works with defaults if settings are unavailable.
    return DEFAULT_SETTINGS;
  }
}

/**
 * Loads a conversation the current visitor owns. The server decides ownership;
 * this returns null when the id is unknown OR belongs to someone else.
 */
export async function fetchOwnConversation(id: string): Promise<Conversation | null> {
  try {
    const row = await apiRequest<Record<string, unknown>>(`/conversations/${id}`);
    return toConversation(row);
  } catch {
    return null;
  }
}

export interface StartConversationInput {
  visitorId: string;
  firstMessage: string;
  customerName?: string | null;
  customerPhone?: string | null;
  campaign: CampaignParams;
}

/** Creates a conversation and its first message in a single atomic call. */
export async function startConversation(input: StartConversationInput): Promise<string> {
  try {
    const data = await apiRequest<{ conversationId: string }>('/conversations', {
      method: 'POST',
      body: {
        // Informational only; the server derives identity from the session cookie.
        visitorId: input.visitorId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        campaign: {
          utm_source: input.campaign.utm_source ?? null,
          utm_medium: input.campaign.utm_medium ?? null,
          utm_campaign: input.campaign.utm_campaign ?? null,
          utm_term: input.campaign.utm_term ?? null,
          utm_content: input.campaign.utm_content ?? null,
          fbclid: input.campaign.fbclid ?? null,
          landing_page: input.campaign.landing_page ?? null,
          referrer: input.campaign.referrer ?? null,
          first_message: input.firstMessage.trim(),
        },
      },
    });
    return data.conversationId;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('unavailable')) throw new Error('CHAT_DISABLED');
    if (message.includes('limit of conversations')) throw new Error('TOO_MANY_CONVERSATIONS');
    throw error;
  }
}

/** Admin-only: close / reopen / change status. */
export async function setConversationStatus(
  id: string,
  status: ConversationStatus,
): Promise<void> {
  await apiRequest(`/admin/conversations/${id}`, { method: 'PATCH', body: { status } });
}
