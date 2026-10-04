/** Conversation data access, now backed by the Express API. */

import { apiRequest } from '../lib/api';
import type {
  AppSettings,
  CampaignParams,
  Conversation,
  ConversationStatus,
} from '../types/chat';
import { asStatus } from '../types/database';
import { isValidPixelId as isValidMetaPixelId } from '../lib/metaPixel';

/** Admin settings, including Meta Ads configuration. */
export interface AdminSettings extends AppSettings {
  meta_pixel_id: string | null;
  meta_tracking_enabled: boolean;
}

/** Result of the admin "Test Pixel" verification. */
export interface MetaPixelVerification {
  /** The typed value is a structurally valid Meta id. */
  validFormat: boolean;
  /** What MongoDB currently holds. */
  saved: string | null;
  /** What `GET /api/public/config` currently returns. */
  served: string | null;
  trackingEnabled: boolean;
  /** The typed value matches what was saved. */
  savedMatches: boolean;
  /** What is saved is what a browser would receive. */
  servedMatches: boolean;
}

/** Shape of `GET /api/public/config`. Safe, public fields only. */
export interface PublicRuntimeConfig {
  company_name: string;
  welcome_message: string;
  chat_enabled: boolean;
  meta_pixel_id: string | null;
  meta_tracking_enabled: boolean;
}

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
  /**
   * Browser-generated Meta event id for this conversion. The server reuses it
   * for the Conversions API so the browser and server events deduplicate in
   * Meta's reporting. Opaque to the server beyond being an id.
   */
  metaEventId?: string | null;
}

/**
 * Public runtime configuration (company name, welcome copy, Meta Pixel id).
 * Unauthenticated by design: the browser needs it before deciding whether to load
 * Meta's script. Returns only allow-listed public fields.
 */
export async function fetchPublicConfig(): Promise<PublicRuntimeConfig> {
  try {
    return await apiRequest<PublicRuntimeConfig>('/public/config');
  } catch {
    // A config failure must never break the chat.
    return {
      company_name: DEFAULT_SETTINGS.company_name,
      welcome_message: DEFAULT_SETTINGS.welcome_message,
      chat_enabled: true,
      meta_pixel_id: null,
      meta_tracking_enabled: false,
    };
  }
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
        // Shared Pixel <-> Conversions API deduplication key. Never a message id
        // and never derived from message content.
        ...(input.metaEventId ? { meta_event_id: input.metaEventId } : {}),
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

/**
 * Admin settings, including the Meta Ads configuration.
 *
 * Admin-only (the server gates this behind `requireAdmin`). Returns the Pixel ID
 * — a public identifier by nature — and the enabled flag. It never returns the
 * Conversions API access token, which is not stored in the database at all.
 */
export async function fetchAdminSettings(): Promise<AdminSettings> {
  const data = await apiRequest<Record<string, unknown>>('/admin/settings');
  return {
    company_name: String(data.company_name ?? DEFAULT_SETTINGS.company_name),
    welcome_message: String(data.welcome_message ?? DEFAULT_SETTINGS.welcome_message),
    chat_enabled: data.chat_enabled !== false,
    meta_pixel_id: (data.meta_pixel_id as string | null) ?? null,
    meta_tracking_enabled: data.meta_tracking_enabled === true,
  };
}

/** Admin-only: persists settings. The server validates the Pixel ID. */
export async function saveAdminSettings(input: {
  companyName: string;
  welcomeMessage: string;
  chatEnabled: boolean;
  metaPixelId: string;
  metaTrackingEnabled: boolean;
}): Promise<AdminSettings> {
  const data = await apiRequest<Record<string, unknown>>('/admin/settings', {
    method: 'PATCH',
    body: {
      companyName: input.companyName,
      welcomeMessage: input.welcomeMessage,
      chatEnabled: input.chatEnabled,
      metaPixelId: input.metaPixelId,
      metaTrackingEnabled: input.metaTrackingEnabled,
    },
  });
  return {
    company_name: String(data.company_name ?? ''),
    welcome_message: String(data.welcome_message ?? ''),
    chat_enabled: data.chat_enabled !== false,
    meta_pixel_id: (data.meta_pixel_id as string | null) ?? null,
    meta_tracking_enabled: data.meta_tracking_enabled === true,
  };
}

/**
 * Admin-only verification for the "Test Pixel" button.
 *
 * Confirms three things without requiring the admin to paste any JavaScript:
 *   * the supplied id is structurally valid,
 *   * the value currently saved in MongoDB is what the server reports,
 *   * the PUBLIC config endpoint actually serves that id to a browser.
 *
 * The access token is never involved and never returned.
 */
export async function verifyMetaPixel(pixelId: string): Promise<MetaPixelVerification> {
  const [admin, publicConfig] = await Promise.all([
    apiRequest<Record<string, unknown>>('/admin/settings'),
    apiRequest<Record<string, unknown>>('/public/config'),
  ]);
  const saved = (admin.meta_pixel_id as string | null) ?? null;
  const served = (publicConfig.meta_pixel_id as string | null) ?? null;
  return {
    validFormat: isValidMetaPixelId(pixelId),
    saved,
    served,
    trackingEnabled: admin.meta_tracking_enabled === true,
    savedMatches: saved === (pixelId.trim() || null),
    servedMatches: served === saved,
  };
}

/** Admin-only: close / reopen / change status. */
export async function setConversationStatus(
  id: string,
  status: ConversationStatus,
): Promise<void> {
  await apiRequest(`/admin/conversations/${id}`, { method: 'PATCH', body: { status } });
}
