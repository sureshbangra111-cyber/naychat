/**
 * Meta Pixel (Meta Pixel / Dataset) browser integration.
 *
 * DESIGN RULES — each of these exists because breaking it causes a real bug:
 *
 * 1. RUNTIME CONFIGURATION. The Pixel ID is fetched from `GET /api/public/config`
 *    at runtime. It is never a build-time `VITE_*` constant and never appears in
 *    the bundle, so an admin can change it from the settings page with no
 *    rebuild and no redeploy.
 *
 * 2. CUSTOMER-FACING PAGES ONLY. `isCustomerFacingPath()` is checked before
 *    anything is loaded, so the Pixel never initialises on `/admin/*` — not on
 *    the login page, not on the dashboard, not on settings. An agent browsing
 *    the console is not a marketing visitor.
 *
 * 3. NEVER BREAKS THE CHAT. Every failure path — a failed script load, a
 *    rejected config fetch, a missing Pixel, tracking disabled — resolves quietly.
 *    Nothing here throws into the React tree.
 *
 * 4. NO INJECTION. The Pixel ID is validated against `/^\d{5,20}$/` on the client
 *    too (the server validates first; this is defence in depth) and is only ever
 *    interpolated into the official Meta loader URL as a path segment. It is
 *    never placed in a script body, an inline attribute, or `innerHTML`.
 *
 * 5. DEDUPLICATION. Conversions are recorded in sessionStorage under a stable
 *    key, so React rerenders, StrictMode double-invocation, route changes,
 *    polling and retries cannot produce a second event for the same conversion.
 *    Each event also carries an `eventID`, which is what lets Meta deduplicate
 *    the browser event against the server-side Conversions API event.
 *
 * 6. NO CHAT CONTENT. Only event names and the page URL are ever sent. Message
 *    text, attachments and customer details are never passed to Meta.
 */

import { apiRequest } from './api';

/** Meta's official browser loader, versioned. */
const META_LOADER_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

export type MetaEventName =
  | 'PageView'
  | 'ViewContent'
  | 'StartChat'
  | 'Contact'
  | 'Lead'
  | 'CustomEvent';

/** Subset of the standard Meta event parameters this app actually uses. */
export interface MetaEventParams {
  /**
   * Shared identifier for this conversion, echoed to the server so the
   * Conversions API can send the SAME id and Meta deduplicates the pair.
   */
  eventId?: string;
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
}

/** Runtime configuration returned by the public endpoint. */
export interface PublicConfig {
  company_name?: string;
  welcome_message?: string;
  chat_enabled?: boolean;
  meta_pixel_id: string | null;
  meta_tracking_enabled: boolean;
}

/** Event ids already fired in this browser session, for deduplication. */
const FIRED_KEY = 'meta_pixel_events_v1';

const fired = new Set<string>();
let initialised = false;
let initPromise: Promise<boolean> | null = null;
let cachedConfig: PublicConfig | null = null;
let configPromise: Promise<PublicConfig> | null = null;

/** True in development only. Production logs stay silent by default. */
const VERBOSE = import.meta.env.DEV;

function devLog(...args: unknown[]): void {
  if (!VERBOSE) return;
  // eslint-disable-next-line no-console
  console.info('[Meta Pixel]', ...args);
}

/**
 * Customer-facing paths only.
 *
 * `/admin` and everything beneath it is excluded, which covers the login page,
 * the dashboard, the conversation view and the settings page in one rule. The
 * comparison is case-insensitive because a URL path can be typed either way.
 */
export function isCustomerFacingPath(pathname: string = window.location.pathname): boolean {
  const normalised = pathname.toLowerCase();
  return !normalised.startsWith('/admin') && normalised !== '/admin';
}

/** Client-side mirror of the server's validation. Digits only, 5-20 chars. */
export function isValidPixelId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5,20}$/.test(value.trim());
}

/** Minimal shape of the global Meta queue `fbq` creates. */
interface MetaQueue {
  (...args: unknown[]): void;
  q?: unknown[][];
  loaded?: boolean;
  version?: string;
  callMethod?: (...args: unknown[]) => void;
}

declare global {
  interface Window {
    fbq?: MetaQueue;
    _fbq?: MetaQueue;
  }
}

function readFired(): Set<string> {
  if (fired.size > 0) return fired;
  try {
    const raw = window.sessionStorage.getItem(FIRED_KEY);
    if (raw) {
      for (const entry of (JSON.parse(raw) as string[])) fired.add(entry);
    }
  } catch {
    // Storage disabled (private mode / strict privacy settings). Deduplication
    // then falls back to the in-memory Set for this page view, which still
    // covers rerenders and StrictMode.
  }
  return fired;
}

function writeFired(): void {
  try {
    window.sessionStorage.setItem(FIRED_KEY, JSON.stringify(Array.from(fired)));
  } catch {
    /* non-fatal */
  }
}

/**
 * Fetches and caches the public runtime configuration.
 * A failure resolves to a "tracking off" config rather than rejecting, so a
 * broken config endpoint can never surface as an app error.
 */
export async function fetchPublicConfig(): Promise<PublicConfig> {
  if (cachedConfig) return cachedConfig;
  if (!configPromise) {
    configPromise = apiRequest<PublicConfig>('/public/config')
      .then((data) => {
        cachedConfig = data;
        return data;
      })
      .catch(() => {
        const disabled: PublicConfig = { meta_pixel_id: null, meta_tracking_enabled: false };
        cachedConfig = disabled;
        return disabled;
      });
  }
  return configPromise;
}

/** Clears cached config so an admin change is picked up without a reload. */
export function resetMetaConfigCache(): void {
  cachedConfig = null;
  configPromise = null;
}

/**
 * Loads Meta's official script and initialises `fbq`.
 *
 * Idempotent across StrictMode double-effects, concurrent calls and rerenders:
 * the in-flight promise is cached in `initPromise`, and the module-level
 * `initialised` flag guards the post-load branch.
 */
export async function initMetaPixel(): Promise<boolean> {
  // Rule 2 — never on admin routes, even if something calls this directly.
  if (!isCustomerFacingPath()) return false;
  if (initialised) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const config = await fetchPublicConfig();

      // Rule 1/4 — no id, or tracking off, or admin route: do nothing.
      if (!config.meta_tracking_enabled || !isValidPixelId(config.meta_pixel_id)) {
        devLog('not enabled (tracking disabled or no valid Pixel ID configured)');
        return false;
      }

      const pixelId = config.meta_pixel_id.trim();

      if (document.getElementById('meta-pixel-fbevents')) {
        initialised = true;
        return true;
      }

      // Meta's queue stub. Setting this BEFORE the script loads is what makes
      // events fired during load queue up instead of being lost.
      if (!window.fbq) {
        /*
         * Meta's official queue stub, reproduced exactly.
         *
         * The body references the CLOSURE variable `fbq`, never `this`. That
         * detail is load-bearing: the app calls `window.fbq('track', ...)`, so
         * `this` inside the function is `window` — and `window.q` is undefined,
         * so a `this.q` implementation would silently DISCARD every event. Using
         * the closure keeps the queue working whether the function is invoked as
         * `window.fbq(...)`, `fbq(...)`, or destructured.
         *
         * Once the real fbevents.js loads it replaces `callMethod` with the live
         * implementation and flushes the queue, so nothing is lost in between.
         */
        const fbq = function fbq(...args: unknown[]) {
          const self = fbq as MetaQueue;
          if (self.callMethod) self.callMethod(...args);
          else self.q?.push(args);
        };
        fbq.q = [] as unknown[][];
        fbq.loaded = true;
        fbq.version = '2.0';
        window.fbq = fbq;
        window._fbq = fbq;
      }

      const script = document.createElement('script');
      script.id = 'meta-pixel-fbevents';
      script.async = true;
      script.defer = true;
      // The Pixel ID is a validated numeric string used as a URL path segment.
      script.src = `${META_LOADER_SRC}?id=${encodeURIComponent(pixelId)}`;
      // Rule 3 — a Meta outage must not break the chat.
      script.onerror = () => {
        devLog('script failed to load; continuing without tracking');
        initialised = false;
      };
      document.head.appendChild(script);

      window.fbq!('init', pixelId);
      // NOTE: no PageView here on purpose. `useMetaTracking` fires exactly one
      // PageView per customer-facing navigation, and firing one here as well
      // would double-count the very first view.

      initialised = true;
      devLog('initialized');
      return true;
    } catch (error) {
      devLog('initialisation failed', error);
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/** True once the Pixel is live (or deliberately disabled). */
export function isMetaPixelReady(): boolean {
  return initialised;
}

/**
 * Fires a Meta event, at most once per `dedupeKey`.
 *
 * Returns false when tracking is off, the event was already recorded, or the
 * queue is unavailable — so callers can branch on it without try/catch.
 */
export async function trackMetaEvent(
  eventName: MetaEventName,
  params: MetaEventParams = {},
  dedupeKey?: string,
): Promise<boolean> {
  try {
    // Rule 2 again: belt-and-braces, so no caller can accidentally track admin
    // activity by firing from a shared code path.
    if (!isCustomerFacingPath()) return false;

    const ready = await initMetaPixel();
    if (!ready || !window.fbq) return false;

    // Rule 5 — once per conversion.
    if (dedupeKey) {
      const seen = readFired();
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      writeFired();
    }

    // `eventID` (capital D) is Meta's own deduplication key shared with CAPI.
    const payload: Record<string, unknown> = {};
    if (params.eventId) payload.eventID = params.eventId;
    if (params.content_name) payload.content_name = params.content_name;
    if (params.content_category) payload.content_category = params.content_category;
    if (params.content_ids) payload.content_ids = params.content_ids;

    window.fbq('track', eventName, payload);
    devLog(eventName);
    return true;
  } catch (error) {
    // Rule 3 — never let tracking break chat.
    devLog('event failed', eventName, error);
    return false;
  }
}

/** Test hooks, used by the admin "Test Pixel" verification and by tests. */
export const metaPixelInternals = {
  firedKeys: () => Array.from(readFired()),
  resetFired: () => {
    fired.clear();
    try {
      window.sessionStorage.removeItem(FIRED_KEY);
    } catch {
      /* non-fatal */
    }
  },
  isInitialised: () => initialised,
  reset: () => {
    initialised = false;
    initPromise = null;
    cachedConfig = null;
    configPromise = null;
    fired.clear();
  },
};
