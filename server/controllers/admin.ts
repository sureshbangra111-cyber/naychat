/**
 * Admin endpoints.
 *
 * Every route below `requireAdmin` is gated by a server-side session lookup —
 * the frontend's route guard is cosmetic only. Credentials are verified against
 * a bcrypt hash; the plaintext password only ever exists in the request body of
 * the login POST.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { attachAdmin, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireObjectId, clampInt, cleanText } from '../utils/validate.js';
import { setAdminCookie, clearAdminCookie, readAdminToken } from '../utils/cookies.js';
import { destroyAdminSession, verifyCredentials, type AdminDTO } from '../services/adminAuth.js';
import {
  addTag,
  getCampaignStats,
  getAdminSettings,
  getConversationForAdmin,
  getDashboardStats,
  listAllMessages,
  listCampaignNames,
  listConversationsForAdmin,
  listEvents,
  listMessagesSince,
  listTags,
  markConversationRead,
  sendAdminMediaMessage,
  sendAdminMessage,
  setConversationStatus,
  updateSettings,
} from '../services/conversations.js';

export const adminRouter = Router();

// Brute-force protection on the credential check specifically.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Failed attempts only, so a legitimate admin signing in repeatedly is not
  // penalised but guessing is.
  skipSuccessfulRequests: true,
  message: {
    error: { code: 'rate_limited', message: 'Too many sign-in attempts. Please try again later.' },
  },
});

adminRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const email = cleanText(body.email, 254);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || password.length === 0) {
      res.status(401).json({
        error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
      });
      return;
    }

    const result = await verifyCredentials(email, password);
    if (!result) {
      res.status(401).json({
        error: { code: 'invalid_credentials', message: 'Invalid email or password.' },
      });
      return;
    }

    setAdminCookie(req, res, result.token);
    res.json({ admin: result.admin });
  }),
);

adminRouter.post('/logout', (req, res) => {
  void destroyAdminSession(readAdminToken(req));
  clearAdminCookie(req, res);
  res.json({ ok: true });
});

/** Everything past this point requires a valid admin session. */
adminRouter.use(attachAdmin, requireAdmin);

adminRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ admin: req.admin });
  }),
);

adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [stats, campaigns] = await Promise.all([getDashboardStats(), getCampaignStats()]);
    res.json({ stats, ...campaigns });
  }),
);

adminRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const limit = clampInt(req.query.limit, 25, 1, 100);
    const offset = clampInt(req.query.offset, 0, 0, 100_000);
    const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const search = cleanText(req.query.search, 200);
    const campaign = cleanText(req.query.campaign, 100);

    res.json(await listConversationsForAdmin({ filter, search, campaign, limit, offset }));
  }),
);

adminRouter.get(
  '/campaigns',
  asyncHandler(async (_req, res) => {
    res.json({ campaigns: await listCampaignNames() });
  }),

);

adminRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    res.json({ conversation: await getConversationForAdmin(id) });
  }),
);

adminRouter.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    const limit = clampInt(req.query.limit, 50, 1, 100);
    const since = typeof req.query.since === 'string' ? req.query.since : null;

    if (since) {
      res.json({ messages: await listMessagesSince(id, since, 100) });
      return;
    }
    res.json({ messages: await listAllMessages(id, limit) });
  }),
);

adminRouter.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    const admin = req.admin as AdminDTO;
    const body = req.body as Record<string, unknown>;

    // Media replies go through the same service the customer path uses, so the
    // admin console produces identical message documents. `admin.id` is the
    // session-derived id — the body's sender fields are ignored entirely.
    if (typeof body.attachmentId === 'string' && body.attachmentId.length > 0) {
      const message = await sendAdminMediaMessage(admin.id, id, {
        attachmentId: body.attachmentId,
        message: body.message,
        clientId: body.clientId,
      });
      res.status(201).json({ message });
      return;
    }

    const message = await sendAdminMessage(admin.id, id, { message: body.message });
    res.status(201).json({ message });
  }),
);

adminRouter.patch(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    const body = req.body as Record<string, unknown>;
    res.json({ conversation: await setConversationStatus(id, body.status) });
  }),
);

adminRouter.post(
  '/conversations/:id/read',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    await markConversationRead(id);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/conversations/:id/events',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    res.json({ events: await listEvents(id) });
  }),
);

adminRouter.get(
  '/conversations/:id/tags',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    res.json({ tags: await listTags(id) });
  }),
);

adminRouter.post(
  '/conversations/:id/tags',
  asyncHandler(async (req, res) => {
    const id = requireObjectId(req.params.id, 'conversation id');
    const body = req.body as Record<string, unknown>;
    await addTag(id, body.tag);
    res.json({ tags: await listTags(id) });
  }),
);

/**
 * Admin settings, including the Meta Ads configuration.
 *
 * Safe to expose to a signed-in admin: it returns the Pixel ID, which is public
 * by nature, and a boolean. It never returns the Conversions API access token,
 * which is not readable from MongoDB at all — it lives only in the environment.
 */
adminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await getAdminSettings());
  }),
);

adminRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    res.json(
      await updateSettings({
        companyName: body.companyName ?? body.company_name,
        welcomeMessage: body.welcomeMessage ?? body.welcome_message,
        chatEnabled: body.chatEnabled ?? body.chat_enabled,
        // Pixel configuration. Validated server-side; never trusted as-is.
        metaPixelId: body.metaPixelId ?? body.meta_pixel_id,
        metaTrackingEnabled: body.metaTrackingEnabled ?? body.meta_tracking_enabled,
      }),
    );
  }),
);
