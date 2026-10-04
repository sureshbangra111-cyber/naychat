import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'brand';
  hint?: string;
}

const tones = {
  default: 'text-slate-500 bg-slate-100',
  success: 'text-emerald-600 bg-emerald-50',
  warning: 'text-amber-600 bg-amber-50',
  brand: 'text-brand-600 bg-brand-50',
} as const;

export function StatCard({ label, value, icon, tone = 'default', hint }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">{value}</p>
          {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
        </div>
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            tones[tone],
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

/** Horizontal bar used for the campaign / source breakdowns (no chart lib). */
export function BarList({
  items,
}: {
  items: Array<{ label: string; count: number }>;
}) {
  if (items.length === 0) {
    return <p className="px-5 py-6 text-center text-sm text-slate-400">No data yet</p>;
  }
  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <ul className="space-y-3 px-5 py-4">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{item.label}</span>
            <span className="shrink-0 font-medium text-slate-900">{item.count}</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
            role="presentation"
          >
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.max((item.count / max) * 100, 3)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}