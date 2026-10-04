import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { StatusBadge } from '../ui/Badge';
import { formatRelativeTime, initials, shortVisitorId, truncate } from '../../lib/utils';
import type { AdminConversationSummary } from '../../types/chat';

interface Props {
  conversations: AdminConversationSummary[];
  activeId?: string | null;
}

/**
 * Inbox list. Each row shows who is chatting, the last message, relative time,
 * status, unread count and the campaign that produced the visit.
 */
export function ConversationList({ conversations, activeId }: Props) {
  return (
    <ul className="divide-y divide-slate-100">
      {conversations.map((conversation) => {
        const isActive = activeId === conversation.id;
        const unread = conversation.unread_count;

        return (
          <li key={conversation.id}>
            <Link
              to={`/admin/conversations/${conversation.id}`}
              aria-current={isActive ? 'true' : undefined}
              className={`flex gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50 ${
                isActive ? 'bg-brand-50/60' : ''
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  unread > 0 ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}
                aria-hidden="true"
              >
                {initials(conversation.customer_name, shortVisitorId(conversation.visitor_id))}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {conversation.customer_name ?? 'Anonymous Visitor'}
                  </p>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {formatRelativeTime(
                      conversation.last_message_at ?? conversation.created_at,
                    )}
                  </span>
                </div>

                <p
                  className={`mt-0.5 truncate text-xs ${
                    unread > 0 ? 'font-medium text-slate-700' : 'text-slate-500'
                  }`}
                >
                  {conversation.last_message
                    ? truncate(conversation.last_message, 80)
                    : 'No messages yet'}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={conversation.status} />
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <Megaphone className="h-3 w-3" aria-hidden="true" />
                    {conversation.utm_campaign ?? conversation.utm_source ?? 'Direct'}
                  </span>
                  {unread > 0 ? (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {unread}
                      <span className="sr-only"> unread messages</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ConversationListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-slate-100" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className="flex gap-3 px-4 py-4">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-slate-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}