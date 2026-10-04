/** Media reads/writes, now backed by the Express API. */

import { apiRequest, ApiRequestError, apiUrl } from '../lib/api';
import type {
  AttachmentLimits,
  Message,
  MessageAttachment,
  MessageType,
  SenderType,
  UploadedAttachment,
} from '../types/chat';

function toAttachment(row: Record<string, unknown>): MessageAttachment {
  return {
    id: String(row.id),
    url: String(row.url),
    kind: row.kind === 'audio' ? 'audio' : 'image',
    mime_type: String(row.mime_type ?? ''),
    size: Number(row.size ?? 0),
    original_name: (row.original_name as string | null) ?? null,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    duration_ms: (row.duration_ms as number | null) ?? null,
  };
}

/**
 * Normalises `type`. Anything that is not explicitly 'image' or 'audio' is a
 * text message — which is exactly what every row written before media support
 * looks like, so old history keeps rendering through the same path.
 */
function toMessageType(row: Record<string, unknown>): MessageType {
  return row.type === 'image' || row.type === 'audio' ? row.type : 'text';
}

function toMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    sender_type: row.sender_type === 'admin' ? 'admin' : 'customer',
    sender_id: (row.sender_id as string | null) ?? null,
    message: String(row.message ?? ''),
    type: toMessageType(row),
    attachment: row.attachment ? toAttachment(row.attachment as Record<string, unknown>) : null,
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

// -----------------------------------------------------------------------------
// Media uploads
// -----------------------------------------------------------------------------

/**
 * Uploads one file to the Express API with REAL progress reporting.
 *
 * XMLHttpRequest is used rather than fetch because `fetch` still cannot report
 * upload progress in any shipping browser, and a 10MB photo on a phone
 * connection needs a progress bar to feel honest. XHR also gives us a genuine
 * `abort()` for the Cancel button mid-upload.
 *
 * Authentication is the same httpOnly cookie the rest of the API uses
 * (`withCredentials`), so no token ever passes through JavaScript.
 */
function uploadWithProgress(options: {
  url: string;
  file: File | Blob;
  filename: string;
  durationMs?: number | null;
  role: 'customer' | 'admin';
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<UploadedAttachment> {
  const { url, file, filename, durationMs, onProgress, signal } = options;

  return new Promise<UploadedAttachment>((resolve, reject) => {
    const form = new FormData();
    // The Blob keeps its real type so the server's MIME cross-check has something
    // honest to compare against the sniffed bytes.
    form.append('file', file, filename);
    if (durationMs !== null && durationMs !== undefined) {
      form.append('durationMs', String(Math.round(durationMs)));
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(url), true);
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.upload.onload = () => {
      // The body is small; 100% of bytes sent is not the same as 200 OK, so the
      // UI shows "Sending…" until the response arrives.
      onProgress(100);
    };

    xhr.onload = () => {
      const payload = xhr.response as {
        attachment?: Record<string, unknown>;
        error?: { code?: string; message?: string };
      } | null;
      if (xhr.status >= 200 && xhr.status < 300 && payload?.attachment) {
        resolve(toAttachment(payload.attachment) as unknown as UploadedAttachment);
        return;
      }
      reject(
        new ApiRequestError(
          xhr.status,
          payload?.error?.code ?? 'upload_failed',
          payload?.error?.message ?? 'That file could not be sent. Please try again.',
        ),
      );
    };

    xhr.onerror = () =>
      reject(
        new ApiRequestError(0, 'network_error', 'Upload failed. Check your connection and try again.'),
      );
    xhr.ontimeout = () =>
      reject(new ApiRequestError(0, 'timeout', 'The upload timed out. Please try again.'));
    xhr.onabort = () =>
      reject(new ApiRequestError(0, 'aborted', 'Upload cancelled.'));

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    xhr.send(form);

    // Clean the listener up as soon as the request settles, whichever way.
    const settle = () => signal?.removeEventListener('abort', onAbort);
    xhr.addEventListener('loadend', settle, { once: true });
  });
}

/** Customer upload path. Ownership is re-verified server-side. */
export function uploadCustomerAttachment(
  conversationId: string,
  file: File | Blob,
  filename: string,
  onProgress: (percent: number) => void,
  options: { durationMs?: number | null; signal?: AbortSignal } = {},
): Promise<UploadedAttachment> {
  return uploadWithProgress({
    url: `/conversations/${conversationId}/attachments`,
    file,
    filename,
    durationMs: options.durationMs ?? null,
    onProgress,
    signal: options.signal,
    role: 'customer',
  });
}

/** Admin upload path. The sender is derived from the session, not the body. */
export function uploadAdminAttachment(
  conversationId: string,
  file: File | Blob,
  filename: string,
  onProgress: (percent: number) => void,
  options: { durationMs?: number | null; signal?: AbortSignal } = {},
): Promise<UploadedAttachment> {
  return uploadWithProgress({
    url: `/admin/conversations/${conversationId}/attachments`,
    file,
    filename,
    durationMs: options.durationMs ?? null,
    onProgress,
    signal: options.signal,
    role: 'admin',
  });
}

/**
 * Drops an upload that was never turned into a message (user cancelled the
 * preview). Best-effort: a failure here must never surface to the user, and the
 * server-side orphan sweep cleans up anything this misses.
 */
export async function discardPendingAttachment(
  conversationId: string,
  attachmentId: string,
  role: 'customer' | 'admin',
): Promise<void> {
  try {
    await apiRequest(
      `/${role === 'admin' ? 'admin' : ''}conversations/${conversationId}/attachments/${attachmentId}`,
      { method: 'DELETE' },
    );
  } catch {
    /* best-effort */
  }
}

/** Server limits, used to fail fast before spending bandwidth. */
export async function fetchAttachmentLimits(): Promise<AttachmentLimits> {
  try {
    return await apiRequest<AttachmentLimits>('/attachment-limits');
  } catch {
    // Conservative defaults matching the server's own defaults.
    return { image_max_bytes: 10 * 1024 * 1024, audio_max_bytes: 10 * 1024 * 1024 };
  }
}

/**
 * Attaches an uploaded attachment to a message.
 *
 * `clientId` is the SAME idempotency key the text path uses, so a retry after a
 * failed send reuses the same key and the server's unique
 * `(conversationId, clientId)` index returns the original message instead of
 * creating a duplicate.
 */
export async function sendMediaMessage(options: {
  conversationId: string;
  attachmentId: string;
  caption?: string;
  clientId: string;
  role: 'customer' | 'admin';
}): Promise<Message | null> {
  const { conversationId, attachmentId, caption, clientId, role } = options;
  const base = role === 'admin' ? `/admin/conversations/${conversationId}/messages` : `/conversations/${conversationId}/messages`;
  const body: Record<string, unknown> = { attachmentId, clientId };
  if (caption && caption.length > 0) body.message = caption;

  if (role === 'customer') {
    const data = await apiRequest<{ messageId: string }>(base, { method: 'POST', body });
    // The customer path returns only an id; the full document arrives on the
    // next poll, exactly like a text message does today.
    void data;
    return null;
  }

  const data = await apiRequest<{ message: Record<string, unknown> }>(base, {
    method: 'POST',
    body,
  });
  return toMessage(data.message);
}

export type { SenderType };
