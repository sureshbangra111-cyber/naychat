import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, MessageSquare } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/Badge';
import { Input } from '../components/ui/Field';
import { useAuth } from '../hooks/useAuth';

/**
 * Admin login (`/admin/login`).
 *
 * The password is submitted once to the Express backend, which verifies it
 * against a bcrypt hash. No credential is ever compared or stored in this
 * bundle, and success is carried by an httpOnly cookie the browser cannot read.
 */
export function AdminLoginPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in as an admin -> skip the form.
  useEffect(() => {
    if (status === 'authenticated') navigate('/admin', { replace: true });
  }, [status, navigate]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">Checking your session…</p>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setSubmitting(true);
    const failure = await signIn(email, password);
    setSubmitting(false);

    if (failure) {
      setError(failure);
      return;
    }
    navigate('/admin', { replace: true });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Support console</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to manage conversations</p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

          <Input
            name="email"
            type="email"
            label="Email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
          />
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            required
          />

          <Button type="submit" className="w-full" loading={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Admin accounts are created on the server. There is no public sign-up.
          </p>
        </form>
      </div>
    </div>
  );
}
