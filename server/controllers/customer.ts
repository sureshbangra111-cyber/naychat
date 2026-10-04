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
import { requireObjectId, clampInt } from '../utils/validate.js';
import {
  getMessagesSince,
  getOlderMessages,
  getOwnedConversation,
  getRecentMessages,
  getSettings,
  sendCustomerMessage,
  startConversation,
  updateCustomerDetails,
  type StartConversationInput,
} from '../services/conversations.js';

export const customerRouter = Router();

customerRouter.use(attachVisitor);

/** Session probe: creates a visitor session on first call. */
customerRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    res.json({ visitor_id: req.visitor!.publicId });
  }),
);

customerRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
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
    const result = await sendCustomerMessage(req.visitor!.visitorId, id, {
      message: body.message,
      clientId: body.clientId,
    });
    res.status(201).json(result);
  }),
);
