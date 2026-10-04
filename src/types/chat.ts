/**
 * Domain types for the application.
 *
 * These mirror the server's Mongoose models (see `server/models/*`). API
 * responses are narrowed at the service layer (see `src/services/*`), so `any`
 * never leaks into components.
 */

export type ConversationStatus = 'open' | 'waiting' | 'closed';
export type SenderType = 'customer' | 'admin';

export interface Conversation {
  id: string;
  visitor_id: string;
  session_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: ConversationStatus;
  assigned_admin_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  fbclid: string | null;
  landing_page: string | null;
  referrer: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  closed_at: string | null;
}

/**
 * Media metadata embedded in a message or returned by the upload endpoint.
 *
 * `url` is always the authorised `/api/attachments/:id` route — never a
 * filesystem path and never a public bucket URL. The browser has no other way to
 * address stored bytes, which is what keeps cross-visitor access impossible.
 */
export interface MessageAttachment {
  id: string;
  url: string;
  kind: 'image' | 'audio';
  mime_type: string;
  size: number;
  original_name: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
}

export type MessageType = 'text' | 'image' | 'audio';

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  message: string;
  /**
   * Derived server-side. Documents written before media support have no `type`
   * and are normalised to 'text', so old and new messages share one renderer.
   */
  type: MessageType;
  attachment: MessageAttachment | null;
  created_at: string;
  read_at: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  client_id: string | null;
}

/** Optimistic message rendered before the server confirms insertion. */
export interface PendingMessage {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  message: string;
  type: MessageType;
  attachment: MessageAttachment | null;
  created_at: string;
  pending: true;
  failed: boolean;
  /** 0-100 while uploading; null when there is nothing left to upload. */
  uploadProgress: number | null;
  /** Distinguishes an image upload from a voice recording in the bubble. */
  uploadKind?: 'image' | 'audio';
  /** Local blob URL for the optimistic preview; revoked once confirmed. */
  previewUrl?: string;
}

export type DisplayMessage = Message | PendingMessage;

/** Response of POST /api/conversations/:id/attachments. */
export interface UploadedAttachment {
  id: string;
  conversation_id: string;
  kind: 'image' | 'audio';
  mime_type: string;
  size: number;
  original_name: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  url: string;
  created_at: string;
}

/** Server-advertised limits, fetched from GET /api/attachment-limits. */
export interface AttachmentLimits {
  image_max_bytes: number;
  audio_max_bytes: number;
}

/** Conversation row as returned by `admin_list_conversations`. */
export interface AdminConversationSummary {
  id: string;
  visitor_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: ConversationStatus;
  assigned_admin_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  fbclid: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message: string | null;
  unread_count: number;
}

export interface DashboardStats {
  total: number;
  open: number;
  waiting: number;
  closed: number;
  today: number;
  unread: number;
}

export interface CampaignCount {
  campaign: string;
  count: number;
}

export interface SourceCount {
  source: string;
  count: number;
}

export interface CampaignStats {
  by_campaign: CampaignCount[];
  by_source: SourceCount[];
}

export interface AdminProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'owner' | 'agent';
  created_at: string;
}

export interface AppSettings {
  company_name: string;
  welcome_message: string;
  chat_enabled: boolean;
}

/** UTM / fbclid attribution captured on the landing chat URL. */
export interface CampaignParams {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  fbclid?: string | null;
  landing_page?: string | null;
  referrer?: string | null;
}

export type ConversationFilter = 'all' | 'open' | 'waiting' | 'closed' | 'today' | 'unread';

export const MAX_MESSAGE_LENGTH = 4000;
export const MESSAGE_PAGE_SIZE = 50;
export const ADMIN_PAGE_SIZE = 25;

/** Polling cadence (ms). Chosen to be light on both the browser and the API. */
export const POLL = {
  customerMessages: 3000,
  adminMessages: 3000,
  conversationList: 7000,
  stats: 10000,
} as const;