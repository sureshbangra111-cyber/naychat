import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, MessageCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Button';
import { cn, formatDateSeparator } from '../../lib/utils';
import type { DisplayMessage } from '../../types/chat';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: DisplayMessage[];
  self: 'customer' | 'admin';
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onDiscard: (id: string) => void;
  emptyTitle: string;
  emptyDescription?: string;
}

/**
 * Scrollable message list with date separators, "load older" pagination and
 * auto-scroll that only yanks the viewport when the user is already at the
 * bottom (otherwise reading history is impossible).
 */
export function MessageList({
  messages,
  self,
  loading,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onDiscard,
  emptyTitle,
  emptyDescription,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isPinned = distance < 120;
    pinnedRef.current = isPinned;
    setPinned(isPinned);
  };

  // Jump to the newest message on first paint and whenever history is loaded.
  useLayoutEffect(() => {
    if (loading) return;
    bottomRef.current?.scrollIntoView({ block: 'end' });
    pinnedRef.current = true;
    setPinned(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Follow new messages only when the user is near the bottom.
  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  let lastDate = '';

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-slim h-full overflow-y-auto bg-slate-50 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
            <Spinner className="h-4 w-4" />
            Loading conversation…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">{emptyTitle}</p>
              {emptyDescription ? (
                <p className="mt-1 text-sm text-slate-500">{emptyDescription}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {hasOlder ? (
              <div className="flex justify-center pb-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onLoadOlder}
                  loading={loadingOlder}
                >
                  Load older messages
                </Button>
              </div>
            ) : (
              <p className="pb-3 text-center text-[11px] text-slate-400">
                Beginning of the conversation
              </p>
            )}

            {messages.map((message) => {
              const day = formatDateSeparator(message.created_at);
              const showSeparator = day !== lastDate;
              lastDate = day;
              return (
                <div key={message.id}>
                  {showSeparator ? (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                        {day}
                      </span>
                    </div>
                  ) : null}
                  <MessageBubble message={message} self={self} onDiscard={onDiscard} />
                </div>
              );
            })}

            <div ref={bottomRef} className={cn('h-1')} />
          </div>
        )}
      </div>

      {!pinned && messages.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            pinnedRef.current = true;
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white p-2 text-slate-500 shadow-md ring-1 ring-slate-200 transition-colors hover:text-slate-800"
          aria-label="Scroll to newest message"
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}