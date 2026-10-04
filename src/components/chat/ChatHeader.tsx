import { MessageSquare, Minimize2, ShieldCheck } from 'lucide-react';

interface Props {
  companyName: string;
  status: 'active' | 'closed';
  onMinimize?: () => void;
  showMinimize?: boolean;
}

/** Customer-facing chat header. */
export function ChatHeader({ companyName, status, onMinimize, showMinimize }: Props) {
  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
        <MessageSquare className="h-5 w-5" aria-hidden="true" />
        {status === 'active' ? (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold text-slate-900">{companyName}</h1>
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          {status === 'active' ? (
            <>
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              We&apos;re here to help
            </>
          ) : (
            <>
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
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
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </header>
  );
}