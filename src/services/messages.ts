/** Message reads/writes, now backed by the Express API. */

import { apiRequest } from '../lib/api';
import type { Message, SenderType } from '../types/chat';

function toMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    sender_type: row.sender_type === 'admin' ? 'admin' : 'customer',
    sender_id: (row.sender_id as string | null) ?? null,
    message: String(row.message ?? ''),
    created_at: String(row.created_at),
    read_at: (row.read_at as string | null) ?? null,
    attachment_url: (row.attachment_url as string | null) ?? null,
    attachment_type: (row.attachment_type as string | null) ?? null,
    client_id: (row.client_id as string | null) ?? null,
  };
}

interface MessagesResponse {
  messages: Record<string, unknown>[];
}

function mapAll(rows: Record<string, unknown>[]): Message[] {
  return rows.map(toMessage);
}

/** Admin-only. Customer reads use the customer path below. */
export async function fetchRecentMessagesForAdmin(
  conversationId: string,
  limit = 50,
): Promise<Message[]> {
  const data = await apiRequest<MessagesResponse>(
    `/admin/conversations/${conversationId}/messages?limit=${limit}`,
  );
  return mapAll(data.messages);
}

export async function fetchMessagesSinceForAdmin(
  conversationId: string,
  since: string,
  limit = 100,
): Promise<Message[]> {
  const data = await apiRequest<MessagesResponse>(
    `/admin/conversations/${conversationId}/messages?since=${encodeURIComponent(since)}&limit=${limit}`,
  );
  return mapAll(data.messages);
}

/** Most recent page of messages, returned oldest-first for rendering. */
export async function fetchRecentMessages(
  conversationId: string,
  limit = 50,
): Promise<Message[]> {
  const data = await apiRequest<MessagesResponse>(
    `/conversations/${conversationId}/messages?limit=${limit}`,
  );
  return mapAll(data.messages);
}

/** Older history, used by the "Load older messages" button. */
export async function fetchOlderMessages(
  conversationId: string,
  before: string,
  limit = 50,
): Promise<Message[]> {
  const data = await apiRequest<MessagesResponse>(
    `/conversations/${conversationId}/messages?before=${encodeURIComponent(before)}&limit=${limit}`,
  );
  return mapAll(data.messages);
}

/** Incremental poll: only messages newer than `since`. */
export async function fetchMessagesSince(
  conversationId: string,
  since: string,
  limit = 100,
): Promise<Message[]> {
  const data = await apiRequest<MessagesResponse>(
    `/conversations/${conversationId}/messages?since=${encodeURIComponent(since)}&limit=${limit}`,
  );
  return mapAll(data.messages);
}

/** Customer send — ownership is re-verified server-side. */
export async function sendCustomerMessage(
  conversationId: string,
  text: string,
  clientId: string,
): Promise<string> {
  try {
    const data = await apiRequest<{ messageId: string }>(
      `/conversations/${conversationId}/messages`,
      { method: 'POST', body: { message: text, clientId } },
    );
    return data.messageId;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('closed')) throw new Error('CONVERSATION_CLOSED');
    if (message.includes('not found')) throw new Error('NOT_YOUR_CONVERSATION');
    throw error;
  }
}

/** Admin send — the server stamps the sender from the session, not the client. */
export async function sendAdminMessage(
  conversationId: string,
  text: string,
): Promise<Message> {
  const data = await apiRequest<{ message: Record<string, unknown> }>(
    `/admin/conversations/${conversationId}/messages`,
    { method: 'POST', body: { message: text.trim() } },
  );
  return toMessage(data.message);
}

/** Admin-only: mark all customer messages in the conversation as read. */
export async function markConversationRead(conversationId: string): Promise<void> {
  try {
    await apiRequest(`/admin/conversations/${conversationId}/read`, { method: 'POST' });
  } catch {
    // Read receipts are best-effort; never surface a failure to the agent.
  }
}

export type { SenderType };
