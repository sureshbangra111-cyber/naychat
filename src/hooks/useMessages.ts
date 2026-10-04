import { useCallback, useEffect, useRef, useState } from 'react';
import { generateUuid } from '../lib/visitor';
import {
  fetchMessagesSince,
  fetchMessagesSinceForAdmin,
  fetchOlderMessages,
  fetchRecentMessages,
  fetchRecentMessagesForAdmin,
  markConversationRead,
  sendAdminMessage,
  sendCustomerMessage,
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
        created_at: new Date().toISOString(),
        pending: true,
        failed: false,
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

  /** Removes a failed optimistic message from the bubble list. */
  const discardFailed = useCallback((id: string) => {
    setMessages((current) => current.filter((item) => item.id !== id));
  }, []);

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
    loadOlder,
    discardFailed,
    clearError: () => setError(null),
  };
}