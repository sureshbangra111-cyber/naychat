import { Link } from 'react-router-dom';
import { MessageCircleQuestion } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
        <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500">
          The page you were looking for does not exist.
        </p>
      </div>
      <Link
        to="/"
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
      >
        Back to home
      </Link>
    </div>
  );
}