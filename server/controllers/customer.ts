/**
 * Customer-facing endpoints.
 *
 * Customers never authenticate: `attachVisitor` guarantees a visitor session on
 * every request. The browser cannot influence WHICH visitor it is — that comes
 * from the HTTP-only cookie only.
 */

import { Router } from 'express';
import { attachVisitor, requireVisitor } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { captureAttribution, getAttribution } from '../services/attribution.js';
import { requireObjectId, clampInt } from '../utils/validate.js';
import {
  getMessagesSince,
  getOlderMessages,
  getPublicConfig,
  getOwnedConversation,
  getRecentMessages,
  getSettings,
  sendCustomerMediaMessage,
  sendCustomerMessage,
  startConversation,
  updateCustomerDetails,
  type StartConversationInput,
} from '../services/conversations.js';

export const customerRouter = Router();

customerRouter.use(attachVisitor);

/**
 * Session probe: creates a visitor session on first call.
 *
 * Also accepts the advertising attribution found in the URL, so it can be stored
 * once on the visitor BEFORE any conversation exists. That is what makes the
 * attribution survive a refresh, a cleaned URL, or a second conversation later on.
 *
 * Attribution is best-effort: a failure here must never block a visitor from
 * chatting, so it is caught and ignored.
 */
customerRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    await captureAttribution(req.visitor!.visitorId, req.query as Record<string, unknown>);
    res.json({ visitor_id: req.visitor!.publicId });
  }),
);

/** Reads back the stored first-touch attribution, for the visitor's own UI. */
customerRouter.get(
  '/attribution',
  requireVisitor,
  asyncHandler(async (req, res) => {
    const stored = await getAttribution(req.visitor!.visitorId);
    res.json({
      source: stored?.source ?? null,
      medium: stored?.medium ?? null,
      campaign: stored?.campaign ?? null,
      term: stored?.term ?? null,
      content: stored?.content ?? null,
      fbclid: stored?.fbclid ?? null,
    });
  }),
);

customerRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
  }),
);

/**
 * Public runtime configuration.
 *
 * Unauthenticated on purpose: the browser needs the Pixel ID before it can decide
 * whether to load Meta's script. The response is an explicit allow-list built by
 * getPublicConfig() — it contains no secret, no database identifier and no
 * session material. The server-only Conversions API access token is never part of
 * it, and this route has no code path that could add one.
 */
customerRouter.get(
  '/public/config',
  asyncHandler(async (_req, res) => {
    // Config is read on every page load; a short cache keeps it fresh enough to
    // pick up an admin change without a rebuild while avoiding a DB hit per view.
    res.setHeader('Cache-Control', 'no-cache');
    res.json(await getPublicConfig());
  }),
);

customerRouter.post(
  '/conversations',
  requireVisitor,
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = await startConversation(req.visitor!.visitorId, {
      visitorId: body.visitorId,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      // Untrusted: every campaign field is individually re-validated and
      // length-capped inside the service before it reaches the database.
      campaign: body.campaign as StartConversationInput['campaign'],
      // Shared Pixel <-> Conversions API dedup key, capped in the service.
      metaEventId: body.meta_event_id ?? body.metaEventId,
      // Request-derived technical identifiers for Meta matching. These are
      // hashed server-side and never stored.
      clientIpAddress: req.ip ?? null,
      clientUserAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json(result);
  }),
);

customerRouter.get(
  '/conversations/:id',
  requireVisitor,
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    res.json(await getOwnedConversation(req.visitor!.visitorId, id));
  }),
);

customerRouter.patch(
  '/conversations/:id',
  requireVisitor,
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    const body = req.body as Record<string, unknown>;
    await updateCustomerDetails(req.visitor!.visitorId, id, {
      customerName: body.customerName,
      customerPhone: body.customerPhone,
    });
    res.json(await getOwnedConversation(req.visitor!.visitorId, id));
  }),
);

/**
 * Messages: one endpoint serves history, older-pages and incremental polling via
 * query params, mirroring the three Supabase reads the frontend used.
 */
customerRouter.get(
  '/conversations/:id/messages',
  requireVisitor,
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    const limit = clampInt(req.query.limit, 50, 1, 100);
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const before = typeof req.query.before === 'string' ? req.query.before : null;

    if (since) {
      res.json({ messages: await getMessagesSince(req.visitor!.visitorId, id, since, 100) });
      return;
    }
    if (before) {
      res.json({ messages: await getOlderMessages(req.visitor!.visitorId, id, before, limit) });
      return;
    }
    res.json({ messages: await getRecentMessages(req.visitor!.visitorId, id, limit) });
  }),
);

customerRouter.post(
  '/conversations/:id/messages',
  requireVisitor,
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    const body = req.body as Record<string, unknown>;

    // A media message carries an `attachmentId` that was uploaded through
    // POST /conversations/:id/attachments in this same session. The caption is
    // optional there, so the two paths must not be conflated: an absent
    // attachment id is still a plain text message, exactly as before.
    if (typeof body.attachmentId === 'string' && body.attachmentId.length > 0) {
      const result = await sendCustomerMediaMessage(req.visitor!.visitorId, id, {
        attachmentId: body.attachmentId,
        message: body.message,
        clientId: body.clientId,
      });
      res.status(201).json(result);
      return;
    }

    const result = await sendCustomerMessage(req.visitor!.visitorId, id, {
      message: body.message,
      clientId: body.clientId,
    });
    res.status(201).json(result);
  }),
);
