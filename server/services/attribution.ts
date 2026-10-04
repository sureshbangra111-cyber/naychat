/**
 * Advertising attribution capture.
 *
 * Responsibilities:
 *   1. Accept the UTM set + fbclid the browser found in the URL.
 *   2. Store it ONCE on the Visitor (first-touch), so it survives the URL being
 *      cleaned, a page refresh, and a visitor starting a second conversation.
 *   3. Apply the stored attribution to a NEW conversation when one is created,
 *      so an admin can see which ad produced the lead even if the visitor
 *      navigated around before typing.
 *
 * FIRST-TOUCH, NOT LAST-TOUCH: an existing attribution is never overwritten. This
 * is deliberate — an organic return visit must not erase the fact that the
 * original click came from a paid ad, or the campaign reporting would collapse
 * to "Direct" for every repeat visitor.
 *
 * PRIVACY: only advertising parameters are stored. No IP address, no user agent,
 * no fingerprint, and nothing derived from conversation content.
 */

import { Visitor } from '../models/Visitor.js';
import { Conversation } from '../models/Conversation.js';
import { cleanText } from '../utils/validate.js';

export interface AttributionInput {
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_term?: unknown;
  utm_content?: unknown;
  fbclid?: unknown;
  landing_page?: unknown;
  referrer?: unknown;
}

export interface StoredAttribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  fbclid: string | null;
  landingPage: string | null;
  referrer: string | null;
}

/** Normalises and length-caps every incoming attribution field. */
export function normaliseAttribution(input: AttributionInput): Partial<StoredAttribution> {
  const out: Partial<StoredAttribution> = {};
  const source = cleanText(input.utm_source, 100);
  const medium = cleanText(input.utm_medium, 100);
  const campaign = cleanText(input.utm_campaign, 100);
  const term = cleanText(input.utm_term, 100);
  const content = cleanText(input.utm_content, 100);
  const fbclid = cleanText(input.fbclid, 200);
  const landingPage = cleanText(input.landing_page, 500);
  const referrer = cleanText(input.referrer, 500);

  // `cleanText` already strips control characters and trims; a value containing
  // markup is stored as inert text and is only ever rendered as a React text
  // node, never as HTML.
  if (source) out.source = source;
  if (medium) out.medium = medium;
  if (campaign) out.campaign = campaign;
  if (term) out.term = term;
  if (content) out.content = content;
  if (fbclid) out.fbclid = fbclid;
  if (landingPage) out.landingPage = landingPage;
  if (referrer) out.referrer = referrer;
  return out;
}

/**
 * Persists first-touch attribution on the Visitor.
 *
 * Idempotent and non-destructive: a field is only written when it is currently
 * empty, so a second call can fill in details the first one missed (for example a
 * referrer arriving after the UTM set) but can never replace real attribution.
 */
export async function captureAttribution(
  visitorId: string,
  input: AttributionInput,
): Promise<StoredAttribution | null> {
  const incoming = normaliseAttribution(input);
  // Nothing worth writing.
  if (Object.keys(incoming).length === 0) return null;

  const existing = await Visitor.findById(visitorId)
    .select('firstAttribution')
    .lean();
  const current = existing?.firstAttribution ?? {};

  // Only fill the blanks; never overwrite what is already recorded.
  const setFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const already = (current as Record<string, unknown>)[key];
    if (!already && value) setFields[`firstAttribution.${key}`] = value;
  }
  if (Object.keys(setFields).length === 0) return current as StoredAttribution;

  if (!current.capturedAt) setFields['firstAttribution.capturedAt'] = new Date();

  await Visitor.updateOne({ _id: visitorId }, { $set: setFields });

  const saved = await Visitor.findById(visitorId).select('firstAttribution').lean();
  return (saved?.firstAttribution as StoredAttribution) ?? null;
}

/** Reads the stored first-touch attribution for a visitor. */
export async function getAttribution(visitorId: string): Promise<StoredAttribution | null> {
  const doc = await Visitor.findById(visitorId).select('firstAttribution').lean();
  if (!doc?.firstAttribution) return null;
  return doc.firstAttribution as StoredAttribution;
}

/**
 * Applies stored attribution to a conversation that does not yet have any.
 *
 * Called when a conversation is created. Existing conversations are never
 * rewritten, so a conversation's attribution reflects the click that produced it
 * rather than a later visit.
 */
export async function applyAttributionToConversation(
  visitorId: string,
  conversationId: string,
): Promise<void> {
  const stored = await getAttribution(visitorId);
  if (!stored) return;
  if (!stored.source && !stored.campaign && !stored.fbclid) return;

  await Conversation.updateOne(
    { _id: conversationId, visitorRef: visitorId },
    {
      $set: {
        // Only fill blanks on the conversation too.
        ...(stored.source ? { utmSource: stored.source } : {}),
        ...(stored.medium ? { utmMedium: stored.medium } : {}),
        ...(stored.campaign ? { utmCampaign: stored.campaign } : {}),
        ...(stored.term ? { utmTerm: stored.term } : {}),
        ...(stored.content ? { utmContent: stored.content } : {}),
        ...(stored.fbclid ? { fbclid: stored.fbclid } : {}),
        ...(stored.landingPage ? { landingPage: stored.landingPage } : {}),
        ...(stored.referrer ? { referrer: stored.referrer } : {}),
      },
    },
  );
}
