import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { cn, formatTime } from '../../lib/utils';
import type { DisplayMessage } from '../../types/chat';

interface Props {
  message: DisplayMessage;
  /** Whose view this is — controls bubble alignment. */
  self: 'customer' | 'admin';
  onDiscard?: (id: string) => void;
}

/**
 * A single message bubble.
 *
 * SECURITY: message text is rendered as a plain React text node. No
 * `dangerouslySetInnerHTML`, no Markdown/HTML parsing — customer input can
 * never be interpreted as markup.
 */
export function MessageBubble({ message, self, onDiscard }: Props) {
  const isPending = 'pending' in message;
  const failed = isPending && message.failed;
  const isSelf = message.sender_type === self;
  const read = !isPending && message.read_at !== null;

  return (
    <div
      className={cn('flex w-full gap-2 px-4', isSelf ? 'justify-end' : 'justify-start')}
    >
      <div className={cn('flex max-w-[85%] flex-col sm:max-w-[70%]', isSelf && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed shadow-sm',
            'whitespace-pre-wrap break-words',
            isSelf
              ? 'rounded-br-md bg-brand-600 text-white'
              : 'rounded-bl-md border border-slate-200 bg-white text-slate-800',
            failed && 'bg-rose-600 text-white',
          )}
        >
          {message.message}
        </div>

        <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
          <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>

          {isSelf ? (
            <>
              {failed ? (
                <>
                  <AlertCircle className="h-3 w-3 text-rose-500" aria-hidden="true" />
                  <span className="text-rose-500">Not sent</span>
                  {onDiscard ? (
                    <button
                      type="button"
                      onClick={() => onDiscard(message.id)}
                      className="font-medium text-rose-600 underline underline-offset-2 hover:no-underline"
                    >
                      Discard
                    </button>
                  ) : null}
                </>
              ) : isPending ? (
                <>
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>Sending…</span>
                </>
              ) : read ? (
                <>
                  <CheckCheck className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Read</span>
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Sent</span>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}