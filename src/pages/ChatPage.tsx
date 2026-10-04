import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCcw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Button';
import { ChatComposer } from '../components/chat/ChatComposer';
import { ChatHeader } from '../components/chat/ChatHeader';
import { MessageList } from '../components/chat/MessageList';
import { PreChatScreen } from '../components/chat/PreChatScreen';
import { useConversation } from '../hooks/useConversation';
import { useMessages } from '../hooks/useMessages';
import { usePolling } from '../hooks/usePolling';
import { POLL } from '../types/chat';

/**
 * Customer chat page (`/chat` and `/chat/:conversationId`).
 *
 * Responsibilities:
 *  * restore the visitor's conversation after a refresh
 *  * create it on the first message
 *  * send messages and poll for admin replies every ~3s
 *  * offer a new conversation once the current one is closed
 */
export function ChatPage() {
  const navigate = useNavigate();
  const { conversationId: routeConversationId } = useParams<{ conversationId: string }>();
  const {
    status,
    error,
    conversation,
    settings,
    starting,
    isClosed,
    startConversation,
    startNewConversation,
    refreshConversation,
  } = useConversation();

  // A URL pointing at a specific conversation overrides the stored one.
  const [requestedId, setRequestedId] = useState<string | null>(routeConversationId ?? null);
  useEffect(() => {
    setRequestedId(routeConversationId ?? null);
  }, [routeConversationId]);

  const activeId = conversation?.id ?? requestedId;
  const showPreChat = status === 'ready' && !conversation && !requestedId;

  const messages = useMessages({
    conversationId: activeId,
    role: 'customer',
    intervalMs: POLL.customerMessages,
  });

  // Keep the conversation status fresh (open/waiting/closed changes).
  usePolling(
    useCallback(async () => {
      await refreshConversation();
    }, [refreshConversation]),
    8000,
    Boolean(activeId),
  );

  const composerHint = useMemo(() => {
    if (isClosed) {
      return 'This conversation has been closed. Start a new conversation to continue.';
    }
    return undefined;
  }, [isClosed]);

  if (status === 'initializing') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          Starting chat…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-5">
        <div className="w-full max-w-md space-y-4">
          <ErrorBanner message={error ?? 'Chat is unavailable.'} />
          <Button onClick={() => window.location.reload()} icon={<RefreshCcw className="h-4 w-4" />}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-white sm:mx-auto sm:my-6 sm:h-[calc(100dvh-3rem)] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm">
      <ChatHeader
        companyName={settings.company_name}
        status={isClosed ? 'closed' : 'active'}
      />

      {showPreChat ? (
        <PreChatScreen
          companyName={settings.company_name}
          welcomeMessage={settings.welcome_message}
          sending={starting}
          onStart={async (input) => {
            const ok = await startConversation(input);
            if (ok) navigate('/chat', { replace: true });
            return ok;
          }}
        />
      ) : (
        <>
          {isClosed ? (
            <div className="border-b border-slate-200 bg-amber-50 px-4 py-3 text-center">
              <p className="text-sm text-amber-900">
                This conversation was closed by our team.
              </p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => {
                  startNewConversation();
                  navigate('/chat', { replace: true });
                }}
              >
                Start a new conversation
              </Button>
            </div>
          ) : null}

          <MessageList
            messages={messages.messages}
            self="customer"
            loading={messages.loading}
            hasOlder={messages.hasOlder}
            loadingOlder={messages.loadingOlder}
            onLoadOlder={() => void messages.loadOlder()}
            onDiscard={messages.discardFailed}
            emptyTitle="No messages yet"
            emptyDescription="Send a message and our team will get back to you shortly."
          />

          {messages.error ? (
            <div className="px-3 pt-3">
              <ErrorBanner
                message={messages.error}
                onDismiss={messages.clearError}
                onRetry={() => void refreshConversation()}
              />
            </div>
          ) : null}

          <ChatComposer
            onSend={messages.send}
            disabled={isClosed || !settings.chat_enabled}
            disabledHint={
              settings.chat_enabled ? composerHint : 'Chat is currently unavailable.'
            }
            side="customer"
          />
        </>
      )}
    </div>
  );
}