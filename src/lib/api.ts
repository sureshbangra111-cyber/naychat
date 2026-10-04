/**
 * API client — replaces the former `lib/supabase.ts`.
 *
 * Talks to the Express backend over `fetch`. There is deliberately NO database
 * credential, no session secret and no admin password in this file (or anywhere
 * under `src/`): identity lives entirely in an httpOnly cookie the browser
 * cannot read, so there is nothing here to leak.
 */

/**
 * Same-origin by default. In development Vite runs on a different port, so the
 * Vite dev proxy forwards /api to the Express server — meaning cookies stay
 * same-origin even in dev. VITE_API_URL is only for a genuinely split
 * deployment and is not a secret.
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}/api${path}`;
}

/** True when a backend has been configured for this deployment. */
export const isApiConfigured = API_BASE.length > 0 || typeof window !== 'undefined';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Single fetch wrapper.
 *
 * `credentials: 'include'` is required: both the visitor session and the admin
 * session are httpOnly cookies, and without this the browser would silently send
 * nothing and every request would look unauthenticated.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    // Network failure / server down. Never surface a raw fetch error.
    throw new ApiRequestError(0, 'network_error', 'Chat is temporarily unavailable. Please try again.');
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorBody = payload as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(
      response.status,
      errorBody?.error?.code ?? 'request_failed',
      // The server already sends user-safe copy. Fall back to something generic
      // rather than exposing anything internal.
      errorBody?.error?.message ?? 'Something went wrong. Please try again.',
    );
  }

  return payload as T;
}

/** Maps any thrown value to a friendly message for the UI. */
export function describeApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.message) return error.message;
  return fallback;
}
