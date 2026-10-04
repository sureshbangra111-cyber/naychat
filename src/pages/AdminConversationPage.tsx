import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Megaphone,
  Phone,
  RotateCcw,
  Tag,
  User,
} from 'lucide-react';
import { Button, Spinner } from '../components/ui/Button';
import { ErrorBanner, StatusBadge } from '../components/ui/Badge';
import { ChatComposer } from '../components/chat/ChatComposer';
import { MessageList } from '../components/chat/MessageList';
import { useAuth } from '../hooks/useAuth';
import { useMessages } from '../hooks/useMessages';
import { usePolling } from '../hooks/usePolling';
import { fetchConversationForAdmin } from '../services/admins';
import { setConversationStatus } from '../services/conversations';
import { formatCampaignLabel } from '../lib/analytics';
import { shortVisitorId } from '../lib/utils';
import { POLL } from '../types/chat';
import type { AdminConversationSummary, ConversationStatus } from '../types/chat';

/**
 * Admin conversation view (`/admin/conversations/:conversationId`).
 *
 * Polls for new customer messages every ~3s and re-reads the conversation row
 * so status changes and closes are reflected without a manual refresh.
 */
export function AdminConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { admin } = useAuth();

  const [summary, setSummary] = useState<AdminConversationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const messages = useMessages({
    conversationId: conversationId ?? null,
    role: 'admin',
    intervalMs: POLL.adminMessages,
  });

  const reloadSummary = useCallback(async () => {
    if (!conversationId) return;
    const next = await fetchConversationForAdmin(conversationId);
    if (next) setSummary(next);
  }, [conversationId]);

  useEffect(() => {
    let active = true;
    if (!conversationId) return;
    setLoading(true);
    void fetchConversationForAdmin(conversationId).then((next) => {
      if (!active) return;
      if (!next) setError('Conversation not found.');
      setSummary(next);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [conversationId]);

  usePolling(reloadSummary, 7000, Boolean(conversationId) && !loading);

  async function changeStatus(status: ConversationStatus) {
    if (!conversationId) return;
    setStatusBusy(true);
    setError(null);
    try {
      await setConversationStatus(conversationId, status);
      await reloadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-slate-500">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorBanner message={error ?? 'Conversation not found.'} />
        <Link to="/admin" className="mt-4 inline-block text-sm text-brand-600 underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const isClosed = summary.status === 'closed';

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
          <Link
            to="/admin"
            aria-label="Back to conversations"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-slate-900">
              {summary.customer_name ?? 'Anonymous Visitor'}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1" title="Visitor ID">
                <User className="h-3 w-3" aria-hidden="true" />
                {shortVisitorId(summary.visitor_id)}
              </span>
              {summary.customer_phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" aria-hidden="true" />
                  {summary.customer_phone}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Megaphone className="h-3 w-3" aria-hidden="true" />
                {formatCampaignLabel(
                  summary.utm_source,
                  summary.utm_medium,
                  summary.utm_campaign,
                )}
              </span>
            </p>
          </div>

          <StatusBadge status={summary.status} />
        </div>

        <div className="mx-auto mt-3 flex w-full max-w-4xl flex-wrap items-center gap-2">
          {isClosed ? (
            <Button
              size="sm"
              variant="secondary"
              loading={statusBusy}
              icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void changeStatus('open')}
            >
              Reopen
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                loading={statusBusy}
                icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => void changeStatus('closed')}
              >
                Close conversation
              </Button>
              {summary.status === 'open' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={statusBusy}
                  icon={<Tag className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => void changeStatus('waiting')}
                >
                  Mark as waiting
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={statusBusy}
                  onClick={() => void changeStatus('open')}
                >
                  Mark as open
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      {error ? (
        <div className="mx-auto w-full max-w-4xl px-4 pt-3">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      ) : null}

      <MessageList
        messages={messages.messages}
        self="admin"
        loading={messages.loading}
        hasOlder={messages.hasOlder}
        loadingOlder={messages.loadingOlder}
        onLoadOlder={() => void messages.loadOlder()}
        onDiscard={messages.discardFailed}
        emptyTitle="No messages yet"
        emptyDescription="Messages from the customer will appear here."
      />

      {messages.error ? (
        <div className="mx-auto w-full max-w-4xl px-4 pb-2">
          <ErrorBanner message={messages.error} onDismiss={messages.clearError} />
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-4xl">
        <ChatComposer
          onSend={messages.send}
          placeholder="Type reply..."
          disabled={isClosed}
          disabledHint="This conversation is closed. Reopen it to reply."
          side="admin"
        />
      </div>

      <p className="sr-only" aria-live="polite">
        Replying as {admin?.email ?? 'admin'}
      </p>
    </div>
  );
}