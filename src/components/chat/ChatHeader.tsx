import { MessageSquare, Minimize2, ShieldCheck } from 'lucide-react';

interface Props {
  companyName: string;
  status: 'active' | 'closed';
  onMinimize?: () => void;
  showMinimize?: boolean;
}

/**
 * Customer-facing chat header.
 *
 * Original design — no third-party branding, logo or assets. It uses the same
 * familiar usability pattern people already know (avatar, title, presence dot,
 * status line) with its own typography, spacing and icon set.
 */
export function ChatHeader({ companyName, status, onMinimize, showMinimize }: Props) {
  const active = status === 'active';

  return (
    <header className="z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
        <MessageSquare className="h-5 w-5" aria-hidden="true" />
        {active ? (
          <span
            className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
            aria-hidden="true"
          />
        ) : null}
        <span className="sr-only">
          {active ? 'Support is available' : 'This conversation is closed'}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] leading-tight font-semibold text-slate-900">
          {companyName}
        </h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          {active ? (
            <>
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              Online &middot; typically replies within a few minutes
            </>
          ) : (
            <>
              <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
              This conversation is closed
            </>
          )}
        </p>
      </div>

      {showMinimize && onMinimize ? (
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimize chat"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </header>
  );
}
