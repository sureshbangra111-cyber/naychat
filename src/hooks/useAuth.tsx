/**
 * Admin session state — the replacement for the Supabase Auth based hook.
 *
 * The browser holds NO credential. Sign-in posts the password to the Express
 * backend once; from then on an httpOnly cookie (unreadable by JavaScript)
 * carries a server-side session. Nothing about "being an admin" is ever trusted
 * from client state — every admin API call re-checks the session on the server,
 * and this hook exists only to decide which screen to render.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { apiRequest } from '../lib/api';
import type { AdminProfile } from '../types/chat';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  admin: AdminProfile | null;
  /** Resolves to an error message on failure, null on success. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function useAuthState(): AuthState {
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Ask the server who we are. A 401 simply means "not signed in" and is the
  // normal state for an anonymous visitor browsing the customer chat.
  useEffect(() => {
    let active = true;

    void apiRequest<{ admin: AdminProfile }>('/admin/me')
      .then((data) => {
        if (!active) return;
        setAdmin(data.admin);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!active) return;
        setAdmin(null);
        setStatus('anonymous');
      });

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const data = await apiRequest<{ admin: AdminProfile }>('/admin/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      setAdmin(data.admin);
      setStatus('authenticated');
      return null;
    } catch (error) {
      // Never surface raw server/driver errors; the backend already returns
      // user-safe copy, and anything else falls back to a generic message.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[auth] sign-in failed', error);
      }
      return error instanceof Error && error.message
        ? error.message
        : 'Invalid email or password.';
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/admin/logout', { method: 'POST' });
    } catch {
      // Even if the call fails, clear local state so the UI leaves the console.
    }
    setAdmin(null);
    setStatus('anonymous');
  }, []);

  return useMemo(() => ({ status, admin, signIn, signOut }), [status, admin, signIn, signOut]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthState();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Consumes the shared admin session state. Must be used inside <AuthProvider>. */
export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within <AuthProvider>');
  return context;
}
