import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MAX_MESSAGE_LENGTH } from '../../types/chat';

interface Props {
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
  disabledHint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** 'customer' themes the button, admin stays neutral. */
  side?: 'customer' | 'admin';
}

/**
 * Message composer.
 *
 * Keyboard behaviour: Enter sends, Shift+Enter inserts a newline.
 * The textarea auto-grows, send is disabled while empty or while a send is in
 * flight, and a hard character cap prevents oversized payloads.
 */
export function ChatComposer({
  onSend,
  disabled = false,
  disabledHint,
  placeholder = 'Type your message...',
  autoFocus = false,
  side = 'customer',
}: Props) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~6 lines, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [value]);

  useEffect(() => {
    if (disabled) return;
    if (autoFocus) textareaRef.current?.focus();
  }, [disabled, autoFocus]);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !sending && !disabled;

  async function handleSend() {
    if (!canSend) return;
    const text = trimmed;
    setSending(true);
    const ok = await onSend(text);
    setSending(false);
    if (ok) {
      setValue('');
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  if (disabled) {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
        {disabledHint ?? 'This conversation is closed.'}
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex items-end gap-2">
        <label htmlFor="chat-composer" className="sr-only">
          {placeholder}
        </label>
        <textarea
          id="chat-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={placeholder}
          disabled={sending}
          className="scroll-slim max-h-36 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!canSend}
          aria-label="Send message"
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
            'disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400',
            side === 'customer'
              ? 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800'
              : 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950',
          )}
        >
          {sending ? (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-90"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          ) : (
            <SendHorizontal className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-slate-400">
        <span aria-live="polite">
          {sending ? 'Sending…' : 'Enter to send · Shift + Enter for a new line'}
        </span>
        {value.length > MAX_MESSAGE_LENGTH - 400 ? (
          <span className={value.length > MAX_MESSAGE_LENGTH - 100 ? 'text-rose-500' : ''}>
            {value.length}/{MAX_MESSAGE_LENGTH}
          </span>
        ) : null}
      </div>
    </div>
  );
}