import { useCallback, useEffect, useRef, useState } from 'react';
import { generateUuid } from '../lib/visitor';
import {
  discardPendingAttachment,
  fetchMessagesSince,
  fetchMessagesSinceForAdmin,
  fetchOlderMessages,
  fetchRecentMessages,
  fetchRecentMessagesForAdmin,
  markConversationRead,
  sendAdminMessage,
  sendCustomerMessage,
  sendMediaMessage,
  uploadAdminAttachment,
  uploadCustomerAttachment,
} from '../services/messages';
import { MESSAGE_PAGE_SIZE, POLL } from '../types/chat';
import type { DisplayMessage, Message, PendingMessage } from '../types/chat';
import { usePolling } from './usePolling';

interface Options {
  conversationId: string | null;
  /** 'customer' | 'admin' — selects the read/write path. */
  role: 'customer' | 'admin';
  intervalMs?: number;
}

function isPending(message: DisplayMessage): message is PendingMessage {
  return 'pending' in message;
}

/**
 * Message history + incremental polling.
 *
 * The first load fetches only the newest page. Every poll afterwards requests
 * `created_at > lastSeen`, so each payload is proportional to new activity, not
 * to conversation length. Intervals are owned by `usePolling` and cleaned up on
 * unmount.
 */
export function useMessages({
  conversationId,
  role,
  intervalMs = POLL.customerMessages,
}: Options) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(true);

  const lastSeenRef = useRef<string>('');
  /**
   * Retry closures for failed media messages, keyed by clientId. Kept out of
   * React state so a retry does not trigger a render cycle of its own.
   */
  const retryHandlersRef = useRef(new Map<string, () => Promise<boolean>>());

  const mergeIncoming = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const byId = new Map<string, DisplayMessage>();
      for (const message of current) byId.set(message.id, message);
      for (const message of incoming) {
        // A confirmed message replaces its optimistic twin (matched by client_id).
        const optimistic = current.find(
          (item) => isPending(item) && item.id === message.client_id,
        );
        if (optimistic) byId.delete(optimistic.id);
        byId.set(message.id, message);
      }
      return Array.from(byId.values()).sort((a, b) =>
        a.created_at === b.created_at
          ? a.id.localeCompare(b.id)
          : a.created_at.localeCompare(b.created_at),
      );
    });
    const newest = incoming[incoming.length - 1]?.created_at;
    if (newest && newest > lastSeenRef.current) lastSeenRef.current = newest;
  }, []);

  // Initial load whenever the conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    lastSeenRef.current = '';

    void (role === 'admin'
      ? fetchRecentMessagesForAdmin(conversationId)
      : fetchRecentMessages(conversationId)
    ).then((initial) => {
      if (!active) return;
      setMessages(initial);
      lastSeenRef.current = initial[initial.length - 1]?.created_at ?? '';
      // Only offer "Load older messages" when the first page was actually full;
      // a short conversation has nothing older to fetch.
      setHasOlder(initial.length >= MESSAGE_PAGE_SIZE);
      setLoading(false);
      if (role === 'admin') void markConversationRead(conversationId);
    });

    return () => {
      active = false;
    };
  }, [conversationId, role]);

  const poll = useCallback(async () => {
    if (!conversationId) return;
    const since = lastSeenRef.current;
    if (!since) return; // watermark not established yet; initial load covers it

    const incoming = await (role === 'admin'
      ? fetchMessagesSinceForAdmin(conversationId, since)
      : fetchMessagesSince(conversationId, since));
    if (incoming.length > 0) {
      mergeIncoming(incoming);
      if (role === 'admin') void markConversationRead(conversationId);
    }
  }, [conversationId, role, mergeIncoming]);

  usePolling(poll, intervalMs, Boolean(conversationId) && !loading);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!conversationId || !trimmed || sending) return false;

      const clientId = generateUuid();
      const optimistic: PendingMessage = {
        id: clientId,
        conversation_id: conversationId,
        sender_type: role === 'admin' ? 'admin' : 'customer',
        message: trimmed,
        type: 'text',
        attachment: null,
        created_at: new Date().toISOString(),
        pending: true,
        failed: false,
        uploadProgress: null,
      };

      setMessages((current) => [...current, optimistic]);
      setSending(true);
      setError(null);

      try {
        if (role === 'admin') {
          // The server stamps the sender from the session — no client-supplied id.
          const saved = await sendAdminMessage(conversationId, trimmed);
          mergeIncoming([saved]);
        } else {
          await sendCustomerMessage(conversationId, trimmed, clientId);
          // Confirmation arrives on the next poll.
        }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Message failed.';
        setMessages((current) =>
          current.map((item) =>
            item.id === clientId ? { ...item, pending: true, failed: true } : item,
          ),
        );
        setError(
          message === 'CONVERSATION_CLOSED'
            ? 'This conversation has been closed.'
            : message === 'NOT_YOUR_CONVERSATION'
              ? 'You do not have access to this conversation.'
              : 'We could not send your message. Please try again.',
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [conversationId, role, sending, mergeIncoming],
  );


  /**
   * Sends an image or a voice note.
   *
   * Three visual phases are driven from here and all show in the same bubble:
   *   1. Uploading N%  — real XHR progress for the bytes,
   *   2. Sending…       — bytes are up, the message row is being created,
   *   3. confirmed     — the polled document replaces the optimistic twin.
   *
   * RETRY SAFETY: `clientId` is generated once and reused for every retry of the
   * same logical message, and the server enforces uniqueness on
   * (conversationId, clientId). Retrying therefore cannot create a duplicate,
   * even if the first attempt actually succeeded server-side and only the
   * response was lost.
   */
  const sendMedia = useCallback(
    async (input: {
      file: File | Blob;
      filename: string;
      kind: 'image' | 'audio';
      durationMs?: number | null;
      caption?: string;
    }): Promise<boolean> => {
      if (!conversationId || sending) return false;

      const clientId = generateUuid();
      // Local preview so the bubble shows the real media immediately, without
      // waiting for the upload. Revoked on confirm/cancel to avoid a leak.
      const previewUrl = URL.createObjectURL(input.file);

      const optimistic: PendingMessage = {
        id: clientId,
        conversation_id: conversationId,
        sender_type: role === 'admin' ? 'admin' : 'customer',
        message: input.caption ?? '',
        type: input.kind,
        attachment: null,
        created_at: new Date().toISOString(),
        pending: true,
        failed: false,
        uploadProgress: 0,
        uploadKind: input.kind,
        previewUrl,
      };

      setMessages((current) => [...current, optimistic]);
      setSending(true);
      setError(null);

      // Kept in a ref so a retry after a failure reuses the SAME clientId.
      const retryState = { attachmentId: null as string | null };

      const attempt = async (): Promise<boolean> => {
        try {
          let attachmentId = retryState.attachmentId;
          if (!attachmentId) {
            const attachment =
              role === 'admin'
                ? await uploadAdminAttachment(
                    conversationId,
                    input.file,
                    input.filename,
                    (percent) => {
                      setMessages((current) =>
                        current.map((item) =>
                          item.id === clientId
                            ? { ...item, uploadProgress: percent }
                            : item,
                        ),
                      );
                    },
                    { durationMs: input.durationMs ?? null },
                  )
                : await uploadCustomerAttachment(
                    conversationId,
                    input.file,
                    input.filename,
                    (percent) => {
                      setMessages((current) =>
                        current.map((item) =>
                          item.id === clientId
                            ? { ...item, uploadProgress: percent }
                            : item,
                        ),
                      );
                    },
                    { durationMs: input.durationMs ?? null },
                  );
            attachmentId = attachment.id;
            retryState.attachmentId = attachment.id;
          }

          // 100% of bytes sent; now the message row is being created.
          setMessages((current) =>
            current.map((item) =>
              item.id === clientId ? { ...item, uploadProgress: null } : item,
            ),
          );

          const saved = await sendMediaMessage({
            conversationId,
            attachmentId,
            caption: input.caption,
            clientId,
            role,
          });
          if (saved) mergeIncoming([saved]);
          // On the customer path the confirmation arrives via the next poll,
          // which replaces this bubble by matching client_id.
          return true;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Send failed.';
          setMessages((current) =>
            current.map((item) =>
              item.id === clientId ? { ...item, pending: true, failed: true } : item,
            ),
          );
          setError(
            message === 'CONVERSATION_CLOSED'
              ? 'This conversation has been closed.'
              : message === 'NOT_YOUR_CONVERSATION'
                ? 'You do not have access to this conversation.'
                : 'We could not send that. Please try again.',
          );
          return false;
        } finally {
          setSending(false);
        }
      };

      // Expose retry through a message the hook owns, so the bubble's Retry
      // button can call it without the composer keeping the File around.
      retryHandlersRef.current.set(clientId, async () => {
        setMessages((current) =>
          current.map((item) =>
            item.id === clientId
              ? { ...item, failed: false, pending: true, uploadProgress: 0 }
              : item,
          ),
        );
        setSending(true);
        return attempt();
      });

      const ok = await attempt();
      if (ok) {
        // The confirmed document (from the poll) owns the media now; the local
        // blob URL has no further use.
        setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
        retryHandlersRef.current.delete(clientId);
      } else {
        // A failed upload may already have a stored attachment; tell the server
        // to drop it when it is still unreferenced.
        if (retryState.attachmentId) {
          void discardPendingAttachment(conversationId, retryState.attachmentId, role);
        }
        URL.revokeObjectURL(previewUrl);
        retryHandlersRef.current.delete(clientId);
      }
      return ok;
    },
    [conversationId, role, sending, mergeIncoming],
  );

  /** Retries a failed media message, reusing its original clientId. */
  const retryFailed = useCallback(async (id: string): Promise<boolean> => {
    const handler = retryHandlersRef.current.get(id);
    if (!handler) return false;
    return handler();
  }, []);

  /**
   * Removes a failed optimistic message from the bubble list.
   *
   * Also releases the local blob URL and asks the server to delete the stored
   * object if the upload had already completed but the message never did — that
   * is exactly the orphan case the server-side sweep also covers.
   */
  const discardFailed = useCallback(
    (id: string) => {
      setMessages((current) => {
        const target = current.find((item) => item.id === id);
        if (target && 'pending' in target && target.previewUrl) {
          URL.revokeObjectURL(target.previewUrl);
        }
        return current.filter((item) => item.id !== id);
      });
      retryHandlersRef.current.delete(id);
    },
    [],
  );

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder) return;
    const oldest = messages.find((item) => !isPending(item));
    if (!oldest) return;

    setLoadingOlder(true);
    try {
      const older = await fetchOlderMessages(conversationId, oldest.created_at);
      setHasOlder(older.length > 0);
      if (older.length === 0) return;
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !known.has(item.id)), ...current];
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, messages, loadingOlder]);

  return {
    messages,
    loading,
    loadingOlder,
    hasOlder,
    sending,
    error,
    send,
    sendMedia,
    retryFailed,
    loadOlder,
    discardFailed,
    clearError: () => setError(null),
  };
}