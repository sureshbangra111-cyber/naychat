import { useCallback, useEffect, useState } from 'react';
import { captureCampaignParams } from '../lib/analytics';
import {
  ensureAnonymousSession,
  getActiveConversationId,
  getVisitorId,
  setActiveConversationId,
} from '../lib/visitor';
import {
  DEFAULT_SETTINGS,
  fetchOwnConversation,
  fetchSettings,
  startConversation as startConversationRpc,
} from '../services/conversations';
import type { AppSettings, CampaignParams, Conversation } from '../types/chat';

type Status = 'initializing' | 'ready' | 'error';

interface StartOptions {
  firstMessage: string;
  customerName?: string | null;
  customerPhone?: string | null;
}

/**
 * Owns the customer's anonymous chat session:
 *  * generates the local visitor UUID
 *  * establishes the invisible server-side session that anchors ownership
 *  * restores an existing conversation after a page refresh
 *  * creates a new conversation on first message
 */
export function useConversation() {
  const [status, setStatus] = useState<Status>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [visitorId, setVisitorId] = useState<string>('');
  const [starting, setStarting] = useState(false);

  // Campaign attribution is captured once, on first load of /chat, and reused
  // when the first message creates the conversation.
  const [campaign] = useState<CampaignParams>(() => captureCampaignParams());

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        setVisitorId(getVisitorId());
        await ensureAnonymousSession();

        const loadedSettings = await fetchSettings();
        if (active) setSettings(loadedSettings);

        const activeId = getActiveConversationId();
        if (activeId) {
          const existing = await fetchOwnConversation(activeId);
          if (active) {
            if (existing) {
              setConversation(existing);
            } else {
              // Not ours / no longer available: drop the stale pointer.
              setActiveConversationId(null);
            }
            setStatus('ready');
          }
          return;
        }

        if (active) setStatus('ready');
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'We could not start the chat. Please refresh and try again.',
        );
        setStatus('error');
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  /** Creates the conversation and stores it locally for later visits. */
  const startConversation = useCallback(
    async ({ firstMessage, customerName, customerPhone }: StartOptions): Promise<boolean> => {
      setStarting(true);
      setError(null);
      try {
        const id = await startConversationRpc({
          visitorId: visitorId || getVisitorId(),
          firstMessage,
          customerName,
          customerPhone,
          campaign,
        });
        setActiveConversationId(id);
        const created = await fetchOwnConversation(id);
        setConversation(created);
        setStatus('ready');
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong.';
        setError(
          message === 'CHAT_DISABLED'
            ? 'Chat is currently unavailable. Please try again later.'
            : message === 'TOO_MANY_CONVERSATIONS'
              ? 'You have reached the limit of conversations from this browser. Please contact us another way.'
              : message,
        );
        return false;
      } finally {
        setStarting(false);
      }
    },
    [visitorId, campaign],
  );

  /** After a conversation is closed, the visitor can begin a fresh one. */
  const startNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setConversation(null);
    setError(null);
  }, []);

  /** Re-reads the conversation row (used by the poll to catch status changes). */
  const refreshConversation = useCallback(async () => {
    if (!conversation) return;
    const fresh = await fetchOwnConversation(conversation.id);
    if (fresh) setConversation(fresh);
  }, [conversation]);

  const isClosed = conversation?.status === 'closed';

  return {
    status,
    error,
    conversation,
    settings,
    visitorId,
    starting,
    isClosed,
    campaign,
    startConversation,
    startNewConversation,
    refreshConversation,
    clearError: () => setError(null),
  };
}