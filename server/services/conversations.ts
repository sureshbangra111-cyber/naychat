/**
 * Conversation + message business logic.
 *
 * This is a direct port of the Supabase RPCs. Each function below names the RPC
 * it replaces so the original behaviour stays traceable:
 *
 *   startConversation()         <- start_conversation()
 *   sendCustomerMessage()       <- send_customer_message()
 *   updateCustomerDetails()     <- customer_update_details()
 *   markConversationRead()      <- mark_conversation_read()
 *   getDashboardStats()         <- admin_dashboard_stats()
 *   getCampaignStats()          <- admin_campaign_stats()
 *   listConversationsForAdmin() <- admin_list_conversations()
 *   listCampaignNames()         <- admin_list_campaigns()
 *
 * Ownership is enforced here against the SERVER-resolved visitor id. The browser
 * never supplies an identity.
 */

import { Types } from 'mongoose';
import {
  Conversation,
  asConversationStatus,
  type ConversationStatus,
} from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { ConversationEvent, ConversationTag } from '../models/ConversationEvent.js';
import { AppSettings, SETTINGS_KEY } from '../models/AppSettings.js';
import { config } from '../config/env.js';
import { ApiError, badRequest, notFound } from '../utils/errors.js';
import { cleanText, validateMessageBody } from '../utils/validate.js';

const LIMITS = config.limits;

/** JSON contract the React app already expects (snake_case). */
export function toConversationDTO(doc: {
  _id: Types.ObjectId;
  visitorId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  status: string;
  assignedAdminRef?: Types.ObjectId | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  fbclid?: string | null;
  landingPage?: string | null;
  referrer?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt?: Date | null;
  closedAt?: Date | null;
}) {
  return {
    id: doc._id.toString(),
    visitor_id: doc.visitorId ?? '',
    customer_name: doc.customerName ?? null,
    customer_phone: doc.customerPhone ?? null,
    status: asConversationStatus(doc.status),
    assigned_admin_id: doc.assignedAdminRef ? doc.assignedAdminRef.toString() : null,
    utm_source: doc.utmSource ?? null,
    utm_medium: doc.utmMedium ?? null,
    utm_campaign: doc.utmCampaign ?? null,
    utm_term: doc.utmTerm ?? null,
    utm_content: doc.utmContent ?? null,
    fbclid: doc.fbclid ?? null,
    landing_page: doc.landingPage ?? null,
    referrer: doc.referrer ?? null,
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
    last_message_at: doc.lastMessageAt ? doc.lastMessageAt.toISOString() : null,
    closed_at: doc.closedAt ? doc.closedAt.toISOString() : null,
  };
}

export function toMessageDTO(doc: {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderType: string;
  senderAdminRef?: Types.ObjectId | null;
  message: string;
  createdAt: Date;
  readAt?: Date | null;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  clientId?: string | null;
}) {
  return {
    id: doc._id.toString(),
    conversation_id: doc.conversationId.toString(),
    sender_type: doc.senderType === 'admin' ? 'admin' : 'customer',
    sender_id: doc.senderAdminRef ? doc.senderAdminRef.toString() : null,
    message: doc.message,
    created_at: doc.createdAt.toISOString(),
    read_at: doc.readAt ? doc.readAt.toISOString() : null,
    attachment_url: doc.attachmentUrl ?? null,
    attachment_type: doc.attachmentType ?? null,
    client_id: doc.clientId ?? null,
  };
}

export interface SummaryDTO extends ReturnType<typeof toConversationDTO> {
  last_message: string | null;
  unread_count: number;
}

export interface SettingsDTO {
  company_name: string;
  welcome_message: string;
  chat_enabled: boolean;
}

export async function getSettings(): Promise<SettingsDTO> {
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  if (!doc) {
    return {
      company_name: config.defaultSettings.companyName,
      welcome_message: config.defaultSettings.welcomeMessage,
      chat_enabled: true,
    };
  }
  return {
    company_name: doc.companyName,
    welcome_message: doc.welcomeMessage,
    chat_enabled: doc.chatEnabled !== false,
  };
}

export async function updateSettings(input: {
  companyName?: unknown;
  welcomeMessage?: unknown;
  chatEnabled?: unknown;
}): Promise<SettingsDTO> {
  const companyName = cleanText(input.companyName, 120);
  const welcomeMessage = cleanText(input.welcomeMessage, 500);
  if (input.chatEnabled !== undefined && typeof input.chatEnabled !== 'boolean') {
    throw badRequest('Invalid value for "Accept new chats".', 'invalid_settings');
  }

  const update: Record<string, unknown> = {};
  if (companyName) update.companyName = companyName;
  if (welcomeMessage) update.welcomeMessage = welcomeMessage;
  if (typeof input.chatEnabled === 'boolean') update.chatEnabled = input.chatEnabled;

  if (Object.keys(update).length === 0) {
    throw badRequest('Nothing to update.', 'empty_update');
  }

  await AppSettings.updateOne(
    { key: SETTINGS_KEY },
    { $set: update, $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true },
  );

  return getSettings();
}

// -----------------------------------------------------------------------------
// Shared message insert — equivalent of the `handle_new_message` trigger
// -----------------------------------------------------------------------------

async function insertMessage(
  conversationId: Types.ObjectId,
  senderType: 'customer' | 'admin',
  text: string,
  senderAdminRef: Types.ObjectId | null,
  clientId?: string | null,
) {
  const message = await Message.create({
    conversationId,
    senderType,
    senderAdminRef,
    message: text,
    clientId: clientId ?? null,
  });

  // Trigger equivalent: bump the conversation, log the event, and flip the
  // conversation to 'waiting' when the customer replies.
  await Conversation.updateOne(
    { _id: conversationId },
    {
      $set: { lastMessageAt: message.createdAt },
      ...(senderType === 'customer' ? { $inc: { unreadCustomerCount: 1 } } : {}),
    },
  );

  await ConversationEvent.create({
    conversationId,
    actorRef: senderAdminRef,
    actorType: senderType,
    eventType: 'message_sent',
  });

  if (senderType === 'customer') {
    await Conversation.updateOne(
      { _id: conversationId, status: 'open' },
      { $set: { status: 'waiting' } },
    );
  }

  return message;
}

// -----------------------------------------------------------------------------
// start_conversation()
// -----------------------------------------------------------------------------

export interface StartConversationInput {
  visitorId?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  campaign?: {
    utm_source?: unknown;
    utm_medium?: unknown;
    utm_campaign?: unknown;
    utm_term?: unknown;
    utm_content?: unknown;
    fbclid?: unknown;
    landing_page?: unknown;
    referrer?: unknown;
    first_message?: unknown;
  } | null;
}

/** Creates a conversation plus its first message. Returns the conversation id. */
export async function startConversation(
  visitorRef: string,
  input: StartConversationInput,
): Promise<{ conversationId: string }> {
  const settings = await getSettings();
  if (!settings.chat_enabled) {
    // Same reason code the RPC raised, so the existing UI copy still matches.
    throw new ApiError(
      503,
      'chat_disabled',
      'Chat is currently unavailable. Please try again later.',
    );
  }

  const campaign = input.campaign ?? {};
  const firstMessage =
    typeof campaign.first_message === 'string'
      ? validateMessageBody(campaign.first_message, LIMITS.hardMessageLength)
      : null;

  // ABUSE CONTROL (ported from the RPC): without a cap a scripted client could
  // flood the collection.
  const existingCount = await Conversation.countDocuments({ visitorRef });
  if (existingCount >= LIMITS.maxConversationsPerVisitor) {
    throw new ApiError(
      429,
      'too_many_conversations',
      'You have reached the limit of conversations from this browser. Please contact us another way.',
    );
  }

  const conversation = await Conversation.create({
    visitorRef,
    // Informational only — never used for authorisation.
    visitorId: cleanText(input.visitorId, 100),
    customerName: cleanText(input.customerName, 100),
    customerPhone: cleanText(input.customerPhone, 40),
    status: 'open',
    utmSource: cleanText(campaign.utm_source, 100),
    utmMedium: cleanText(campaign.utm_medium, 100),
    utmCampaign: cleanText(campaign.utm_campaign, 100),
    utmTerm: cleanText(campaign.utm_term, 100),
    utmContent: cleanText(campaign.utm_content, 100),
    fbclid: cleanText(campaign.fbclid, 200),
    landingPage: cleanText(campaign.landing_page, 500),
    referrer: cleanText(campaign.referrer, 500),
  });

  await ConversationEvent.create({
    conversationId: conversation._id,
    actorType: 'customer',
    eventType: 'conversation_started',
  });

  if (firstMessage) {
    await insertMessage(conversation._id, 'customer', firstMessage, null);
  }

  return { conversationId: conversation._id.toString() };
}

// -----------------------------------------------------------------------------
// send_customer_message()
// -----------------------------------------------------------------------------

export async function sendCustomerMessage(
  visitorRef: string,
  conversationId: string,
  input: { message?: unknown; clientId?: unknown },
): Promise<{ messageId: string }> {
  const text = validateMessageBody(input.message, LIMITS.hardMessageLength);
  const clientId = cleanText(input.clientId, 100);

  // SECURITY-CRITICAL ownership check, server-side against the session visitor.
  const conversation = await Conversation.findOne({ _id: conversationId, visitorRef });
  if (!conversation) {
    // 404 rather than 403 so a caller cannot probe for other visitors' ids.
    throw notFound('Conversation not found.', 'not_your_conversation');
  }
  if (conversation.status === 'closed') {
    throw new ApiError(409, 'conversation_closed', 'This conversation has been closed.');
  }

  // Idempotency step 1: an explicit retry returns the original id.
  if (clientId) {
    const existing = await Message.findOne({ conversationId, clientId }).lean();
    if (existing) return { messageId: existing._id.toString() };
  }

  try {
    const message = await insertMessage(conversation._id, 'customer', text, null, clientId);
    return { messageId: message._id.toString() };
  } catch (error) {
    // Idempotency step 2: concurrent retries raced past step 1. The unique index
    // arbitrates; return the winner instead of failing the user's send.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: number }).code === 11000 &&
      clientId
    ) {
      const winner = await Message.findOne({ conversationId, clientId }).lean();
      if (winner) return { messageId: winner._id.toString() };
    }
    throw error;
  }
}

// -----------------------------------------------------------------------------
// customer_update_details()
// -----------------------------------------------------------------------------

export async function updateCustomerDetails(
  visitorRef: string,
  conversationId: string,
  input: { customerName?: unknown; customerPhone?: unknown },
): Promise<void> {
  const set: Record<string, unknown> = {};
  const name = cleanText(input.customerName, 100);
  const phone = cleanText(input.customerPhone, 40);
  if (name) set.customerName = name;
  if (phone) set.customerPhone = phone;
  if (Object.keys(set).length === 0) return;

  await Conversation.updateOne({ _id: conversationId, visitorRef }, { $set: set });
}

// -----------------------------------------------------------------------------
// Customer reads — always scoped to the visitor's own conversations
// -----------------------------------------------------------------------------

export async function getOwnedConversation(visitorRef: string, conversationId: string) {
  const doc = await Conversation.findOne({ _id: conversationId, visitorRef });
  if (!doc) throw notFound('Conversation not found.', 'not_your_conversation');
  return toConversationDTO(doc);
}

/** Newest page of messages for an owned conversation. */
export async function getRecentMessages(
  visitorRef: string,
  conversationId: string,
  limit: number,
) {
  const owned = await Conversation.exists({ _id: conversationId, visitorRef });
  if (!owned) throw notFound('Conversation not found.', 'not_your_conversation');

  const docs = await Message.find({ conversationId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return docs.reverse().map(toMessageDTO);
}

/** Older page, used by the "Load older messages" button. */
export async function getOlderMessages(
  visitorRef: string,
  conversationId: string,
  before: string,
  limit: number,
) {
  const owned = await Conversation.exists({ _id: conversationId, visitorRef });
  if (!owned) throw notFound('Conversation not found.', 'not_your_conversation');

  const docs = await Message.find({ conversationId, createdAt: { $lt: new Date(before) } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return docs.reverse().map(toMessageDTO);
}

/** Incremental poll: only messages newer than `since`. */
export async function getMessagesSince(
  visitorRef: string,
  conversationId: string,
  since: string,
  limit: number,
) {
  const owned = await Conversation.exists({ _id: conversationId, visitorRef });
  if (!owned) throw notFound('Conversation not found.', 'not_your_conversation');

  const docs = await Message.find({ conversationId, createdAt: { $gt: new Date(since) } })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean();
  return docs.map(toMessageDTO);
}

// -----------------------------------------------------------------------------
// Admin reads/writes
// -----------------------------------------------------------------------------

export async function getConversationForAdmin(conversationId: string): Promise<SummaryDTO> {
  const doc = await Conversation.findById(conversationId).lean();
  if (!doc) throw notFound('Conversation not found.');

  const last = await Message.findOne({ conversationId }).sort({ createdAt: -1 }).lean();

  return {
    ...toConversationDTO(doc),
    last_message: last ? last.message : null,
    unread_count: doc.unreadCustomerCount ?? 0,
  };
}

export async function sendAdminMessage(
  adminId: string,
  conversationId: string,
  input: { message?: unknown },
) {
  const text = validateMessageBody(input.message, LIMITS.hardMessageLength);

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw notFound('Conversation not found.');
  if (conversation.status === 'closed') {
    throw new ApiError(409, 'conversation_closed', 'This conversation is closed. Reopen it to reply.');
  }

  const message = await insertMessage(
    conversation._id,
    'admin',
    text,
    new Types.ObjectId(adminId),
  );

  await ConversationEvent.create({
    conversationId: conversation._id,
    actorRef: new Types.ObjectId(adminId),
    actorType: 'admin',
    eventType: 'status_changed',
    metadata: { note: 'admin_replied' },
  });

  return toMessageDTO(message);
}

/** Close / reopen / change status. */
export async function setConversationStatus(conversationId: string, status: unknown) {
  if (status !== 'open' && status !== 'waiting' && status !== 'closed') {
    throw badRequest('Invalid conversation status.', 'invalid_status');
  }
  const nextStatus = status as ConversationStatus;

    // `returnDocument: 'after'` instead of the deprecated `new: true` option.
    const updated = await Conversation.findByIdAndUpdate(
      conversationId,
      { $set: { status: nextStatus, closedAt: nextStatus === 'closed' ? new Date() : null } },
      { returnDocument: 'after' },
    ).lean();
  if (!updated) throw notFound('Conversation not found.');

  await ConversationEvent.create({
    conversationId,
    actorType: 'admin',
    eventType: 'status_changed',
    metadata: { status: nextStatus },
  });

  return toConversationDTO(updated);
}

/** mark_conversation_read() */
export async function markConversationRead(conversationId: string): Promise<void> {
  await Message.updateMany(
    { conversationId, senderType: 'customer', readAt: null },
    { $set: { readAt: new Date() } },
  );
  await Conversation.updateOne({ _id: conversationId }, { $set: { unreadCustomerCount: 0 } });
}

/** Public read for the admin inbox. */
export async function listAllMessages(conversationId: string, limit: number) {
  const docs = await Message.find({ conversationId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return docs.reverse().map(toMessageDTO);
}

/** Incremental poll for the admin view. */
export async function listMessagesSince(
  conversationId: string,
  since: string,
  limit: number,
) {
  const docs = await Message.find({ conversationId, createdAt: { $gt: new Date(since) } })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean();
  return docs.map(toMessageDTO);
}

// -----------------------------------------------------------------------------
// admin_list_conversations()
// -----------------------------------------------------------------------------

export interface ListParams {
  filter: string;
  search: string | null;
  campaign: string | null;
  limit: number;
  offset: number;
}

export async function listConversationsForAdmin(params: ListParams): Promise<{
  rows: SummaryDTO[];
  count: number;
}> {
  const query: Record<string, unknown> = {};

  switch (params.filter) {
    case 'open':
    case 'waiting':
    case 'closed':
      query.status = params.filter;
      break;
    case 'today': {
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfToday };
      break;
    }
    case 'unread':
      query.status = { $ne: 'closed' };
      query.unreadCustomerCount = { $gt: 0 };
      break;
    default:
      break;
  }

  if (params.campaign) query.utmCampaign = params.campaign;

  if (params.search) {
    // Escape regex metacharacters so the search box can never inject a pattern.
    const safe = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    query.$or = [{ customerName: rx }, { customerPhone: rx }, { visitorId: rx }];
  }

  const [total, docs] = await Promise.all([
    Conversation.countDocuments(query),
    Conversation.find(query)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip(params.offset)
      .limit(params.limit)
      .lean(),
  ]);

  // Last message for just this page, not the whole collection.
  const ids = docs.map((d) => d._id);
  const lastMessages = await Message.aggregate<{ _id: Types.ObjectId; message: string }>([
    { $match: { conversationId: { $in: ids } } },
    { $sort: { conversationId: 1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$conversationId', message: { $first: '$message' } } },
  ]);
  const lastByConversation = new Map(lastMessages.map((m) => [m._id.toString(), m.message]));

  const rows: SummaryDTO[] = docs.map((doc) => ({
    ...toConversationDTO(doc),
    last_message: lastByConversation.get(doc._id.toString()) ?? null,
    unread_count: doc.unreadCustomerCount ?? 0,
  }));

  return { rows, count: total };
}

// -----------------------------------------------------------------------------
// admin_dashboard_stats()
// -----------------------------------------------------------------------------

export async function getDashboardStats() {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const [total, open, waiting, closed, today, unread] = await Promise.all([
    Conversation.countDocuments({}),
    Conversation.countDocuments({ status: 'open' }),
    Conversation.countDocuments({ status: 'waiting' }),
    Conversation.countDocuments({ status: 'closed' }),
    Conversation.countDocuments({ createdAt: { $gte: startOfToday } }),
    Conversation.countDocuments({ status: { $ne: 'closed' }, unreadCustomerCount: { $gt: 0 } }),
  ]);

  return { total, open, waiting, closed, today, unread };
}

// -----------------------------------------------------------------------------
// admin_campaign_stats()
// -----------------------------------------------------------------------------

export async function getCampaignStats() {
  const byCampaign = await Conversation.aggregate<{ _id: string | null; count: number }>([
    { $group: { _id: '$utmCampaign', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const bySource = await Conversation.aggregate<{ _id: string | null; count: number }>([
    { $group: { _id: '$utmSource', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return {
    by_campaign: byCampaign.map((r) => ({ campaign: r._id ?? 'No campaign', count: r.count })),
    by_source: bySource.map((r) => ({ source: r._id ?? 'Direct', count: r.count })),
  };
}

/** admin_list_campaigns() */
export async function listCampaignNames(): Promise<string[]> {
  const rows = await Conversation.distinct('utmCampaign', { utmCampaign: { $ne: null } });
  return rows.filter((r): r is string => typeof r === 'string' && r.length > 0).sort();
}

// -----------------------------------------------------------------------------
// Events + tags
// -----------------------------------------------------------------------------

export async function listEvents(conversationId: string) {
  const docs = await ConversationEvent.find({ conversationId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return docs.map((d) => ({
    id: d._id.toString(),
    conversation_id: d.conversationId.toString(),
    actor_id: d.actorRef ? d.actorRef.toString() : null,
    actor_type: d.actorType,
    event_type: d.eventType,
    metadata: d.metadata ?? null,
    created_at: d.createdAt.toISOString(),
  }));
}

export async function listTags(conversationId: string): Promise<string[]> {
  const docs = await ConversationTag.find({ conversationId }).lean();
  return docs.map((d) => d.tag);
}

export async function addTag(conversationId: string, tag: unknown): Promise<void> {
  const value = cleanText(tag, 50)?.toLowerCase();
  if (!value) throw badRequest('Please provide a tag.', 'empty_tag');
  if (!(await Conversation.exists({ _id: conversationId }))) {
    throw notFound('Conversation not found.');
  }
  await ConversationTag.updateOne(
    { conversationId, tag: value },
    { $setOnInsert: { conversationId, tag: value } },
    { upsert: true },
  );
}
