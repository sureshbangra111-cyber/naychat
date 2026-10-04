import type { CampaignParams } from '../types/chat';

const MAX_FIELD_LENGTH = 500;

/** Reads a URL parameter, trimming and capping its length. */
function readParam(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (!raw) return null;
  const value = raw.trim().slice(0, MAX_FIELD_LENGTH);
  return value.length > 0 ? value : null;
}

/**
 * Captures Meta / UTM attribution from the current URL.
 *
 * Call this on `/chat` before the first message is sent. Values are stored once
 * with the conversation so later edits to the URL do not change history.
 * Missing parameters are simply `null` — nothing here is required.
 */
export function captureCampaignParams(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): CampaignParams {
  const params = new URLSearchParams(search);

  let referrer: string | null = null;
  let landingPage: string | null = null;
  if (typeof window !== 'undefined') {
    referrer = document.referrer ? document.referrer.slice(0, MAX_FIELD_LENGTH) : null;
    landingPage = `${window.location.origin}${window.location.pathname}`.slice(
      0,
      MAX_FIELD_LENGTH,
    );
  }

  return {
    utm_source: readParam(params, 'utm_source'),
    utm_medium: readParam(params, 'utm_medium'),
    utm_campaign: readParam(params, 'utm_campaign'),
    utm_term: readParam(params, 'utm_term'),
    utm_content: readParam(params, 'utm_content'),
    fbclid: readParam(params, 'fbclid'),
    landing_page: landingPage,
    referrer,
  };
}

/** Human-readable "facebook / paid_social / summer_sale" label for the inbox. */
export function formatCampaignLabel(
  source: string | null,
  medium: string | null,
  campaign: string | null,
): string {
  const parts = [source, medium, campaign].filter(Boolean) as string[];
  if (parts.length === 0) return 'Direct';
  return parts.join(' / ');
}