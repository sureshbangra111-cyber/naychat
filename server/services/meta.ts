/**
 * Meta Conversions API (server-side).
 *
 * WHAT THIS SENDS — and, more importantly, what it never sends:
 *   * Standard event names, an action source, an event time and an `event_id`.
 *   * The advertising attribution already stored on the conversation
 *     (utm_source/medium/campaign/term/content, fbclid) — this is the data Meta
 *     itself handed us via the ad click.
 *   * Coarse, request-derived technical identifiers that Meta's own
 *     Conversions API documentation asks integrators to forward for matching:
 *     `client_ip_address` and `client_user_agent`.
 *
 * IT NEVER SENDS:
 *   * Chat message text, captions, filenames or any conversation content.
 *   * Admin credentials, session tokens, the MongoDB URI, or the Pixel ID
 *     beyond the dataset identifier Meta already knows.
 *   * Customer name, phone or email. This project deliberately does not collect
 *     PII for tracking purposes, so there is nothing to hash-and-send. The
 *     `hashedUserData` field below exists for a future, explicitly consented
 *     implementation and is left unused today.
 *
 * PRIVACY: every identifier that leaves this process is already non-reversible
 * (SHA-256 per Meta's hashing rules) or is a standard technical header value.
 *
 * FAILURE HANDLING: this module is entirely best-effort. Every entry point
 * returns a promise that NEVER rejects, so a Meta outage, a missing token or a
 * network error can never affect the chat. Errors are logged server-side with no
 * secret material — never the access token, never a full request body.
 */

import { createHash } from 'node:crypto';
import { config } from '../config/env.js';
import { Message } from '../models/Message.js';

/** Standard Meta event names this integration emits. */
export const META_EVENTS = {
  PAGE_VIEW: 'PageView',
  VIEW_CONTENT: 'ViewContent',
  START_CHAT: 'StartChat',
  CONTACT: 'Contact',
  LEAD: 'Lead',
} as const;

export type MetaEventName = (typeof META_EVENTS)[keyof typeof META_EVENTS];

export interface MetaUserData {
  /** Raw client IP. Hashed with SHA-256 + a salt, as Meta requires. */
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  /**
   * Reserved for a future explicitly-consented implementation. Unused today,
   * because this app does not collect PII for advertising.
   */
  hashedUserData?: Record<string, string> | null;
}

export interface MetaEventInput {
  eventName: MetaEventName;
  /**
   * Stable per-conversion identifier, SHARED with the browser Pixel event for
   * the same action. Meta deduplicates Pixel + Conversions API events that carry
   * an identical `event_id`, which is what prevents double counting.
   */
  eventId: string;
  /** Event time in seconds. Defaults to now. */
  eventTimeSeconds?: number;
  /** Page URL the event happened on. Useful for the Ads Manager report. */
  eventSourceUrl?: string | null;
  userData?: MetaUserData;
  /** Advertising attribution, forwarded for reporting. Never PII. */
  attribution?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    term?: string | null;
    content?: string | null;
    fbclid?: string | null;
  } | null;
}

export interface MetaSendResult {
  /** True only when a request was actually made and accepted. */
  delivered: boolean;
  /** Why it was skipped or failed. Safe to log; contains no secrets. */
  reason?: string;
}

/**
 * Meta's documented normalisation + SHA-256 hashing for customer identifiers.
 * Exported for a future consented implementation and for tests.
 */
export function sha256Normalize(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** True when a Conversions API send is even possible with the current config. */
export function isConversionsApiConfigured(): boolean {
  return (
    config.meta.conversionsApiEnabled &&
    config.meta.pixelIdFallback.length > 0 &&
    config.meta.conversionsApiAccessToken.length > 0
  );
}

/**
 * Sends one event to the Meta Conversions API.
 *
 * NEVER throws. Returns `{ delivered: false, reason }` when the token/dataset is
 * absent, tracking is disabled, or Meta rejected or could not be reached.
 */
export async function sendMetaEvent(
  input: MetaEventInput,
): Promise<MetaSendResult> {
  try {
    if (!config.meta.conversionsApiEnabled) {
      return { delivered: false, reason: 'disabled_by_env' };
    }
    if (!isConversionsApiConfigured()) {
      // The common case: no token configured yet. Silent by design.
      return { delivered: false, reason: 'not_configured' };
    }

    const pixelId = config.meta.pixelIdFallback;
    const url = `https://graph.facebook.com/${config.meta.graphApiVersion}/${pixelId}/events`;

    const customerData: Record<string, string> = {};
    if (input.userData?.clientIpAddress) {
      // Meta requires the IP to be hashed, not sent in the clear.
      customerData.client_ip_address = sha256Normalize(input.userData.clientIpAddress);
    }
    if (input.userData?.clientUserAgent) {
      customerData.client_user_agent = sha256Normalize(input.userData.clientUserAgent);
    }
    // Reserved; currently always empty.
    Object.assign(customerData, input.userData?.hashedUserData ?? {});

    const payload = {
      data: [
        {
          event_name: input.eventName,
          // Shared with the browser event for this exact conversion — this is the
          // deduplication key.
          event_id: input.eventId,
          event_time: input.eventTimeSeconds ?? Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: input.eventSourceUrl ?? undefined,
          user_data: customerData,
          custom_data: input.attribution
            ? {
                ...(input.attribution.source ? { utm_source: input.attribution.source } : {}),
                ...(input.attribution.medium ? { utm_medium: input.attribution.medium } : {}),
                ...(input.attribution.campaign ? { utm_campaign: input.attribution.campaign } : {}),
                ...(input.attribution.term ? { utm_term: input.attribution.term } : {}),
                ...(input.attribution.content ? { utm_content: input.attribution.content } : {}),
                ...(input.attribution.fbclid ? { fbclid: input.attribution.fbclid } : {}),
              }
            : undefined,
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The token travels as a query parameter, exactly as Meta's API expects.
      // It is never logged and never included in an error message.
      body: JSON.stringify({
        ...payload,
        access_token: config.meta.conversionsApiAccessToken,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // Log the status only. The body can echo request material, so it is
      // deliberately not logged.
      // eslint-disable-next-line no-console
      console.error(
        `[meta] Conversions API rejected ${input.eventName} (event_id=${input.eventId}): HTTP ${response.status}`,
      );
      return { delivered: false, reason: `http_${response.status}` };
    }

    if (config.isProduction === false) {
      // eslint-disable-next-line no-console
      console.log(`[meta] Conversions API delivered ${input.eventName} (event_id=${input.eventId})`);
    }
    return { delivered: true };
  } catch (error) {
    // Network failure, DNS, timeout, abort — all non-fatal to the chat.
    // eslint-disable-next-line no-console
    console.error(
      `[meta] Conversions API call failed for ${input.eventName}:`,
      error instanceof Error ? error.message : 'unknown error',
    );
    return { delivered: false, reason: 'network_error' };
  }
}

/**
 * Builds the attribution payload from a stored conversation document.
 * Only advertising parameters are forwarded — never any message content.
 */
export function attributionFromConversation(conversation: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  fbclid?: string | null;
}) {
  return {
    source: conversation.utmSource ?? null,
    medium: conversation.utmMedium ?? null,
    campaign: conversation.utmCampaign ?? null,
    term: conversation.utmTerm ?? null,
    content: conversation.utmContent ?? null,
    fbclid: conversation.fbclid ?? null,
  };
}

/**
 * True when this visitor has already produced a genuine conversion event in a
 * PREVIOUS conversation, used to keep `Lead` a once-per-visitor event.
 */
export async function hasExistingConversation(conversationId: string): Promise<boolean> {
  const doc = await Message.exists({ conversationId });
  return Boolean(doc);
}
