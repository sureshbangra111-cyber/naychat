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
import {
  cleanText,
  requireObjectId,
  validateMessageBody,
  validateMetaPixelId,
} from '../utils/validate.js';
import { Attachment } from '../models/Attachment.js';
import { claimAttachment } from './attachments/service.js';
import { applyAttributionToConversation } from './attribution.js';
import {
  META_EVENTS,
  attributionFromConversation,
  sendMetaEvent,
} from './meta.js';

const LIMITS = config.limits;

/**
 * Returns a claimed attachment to the 'pending' pool after a failed message
 * insert. Scoped to `state: 'attached'` so it can never un-claim an attachment
 * that some other request already attached to a real message.
 */
async function releaseAttachment(attachmentId: Types.ObjectId): Promise<void> {
  await Attachment.updateOne(
    { _id: attachmentId, state: 'attached' },
    { $set: { state: 'pending', attachedAt: null } },
  );
}

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
  /** Present only on image/audio messages. */
  type?: string | null;
  attachment?: {
    attachmentId: Types.ObjectId;
    storageKey?: string;
    mimeType: string;
    size: number;
    originalName?: string | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
  } | null;
}) {
  // `type` is derived, not trusted: a document without one is a text message,
  // which is exactly what every pre-existing row is.
  const type =
    doc.type === 'image' || doc.type === 'audio'
      ? doc.type
      : doc.attachment
        ? doc.attachment.mimeType.startsWith('image/')
          ? 'image'
          : 'audio'
        : 'text';

  const attachment = doc.attachment
    ? {
        // The browser gets an id and an authorised route — never a storage key,
        // never a filesystem path.
        id: doc.attachment.attachmentId.toString(),
        url: `/api/attachments/${doc.attachment.attachmentId.toString()}`,
        kind: doc.attachment.mimeType.startsWith('image/') ? ('image' as const) : ('audio' as const),
        mime_type: doc.attachment.mimeType,
        size: doc.attachment.size,
        original_name: doc.attachment.originalName ?? null,
        width: doc.attachment.width ?? null,
        height: doc.attachment.height ?? null,
        duration_ms: doc.attachment.durationMs ?? null,
      }
    : null;

  return {
    id: doc._id.toString(),
    conversation_id: doc.conversationId.toString(),
    sender_type: doc.senderType === 'admin' ? 'admin' : 'customer',
    sender_id: doc.senderAdminRef ? doc.senderAdminRef.toString() : null,
    message: doc.message,
    type,
    attachment,
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

/**
 * PUBLIC runtime configuration.
 *
 * This is the ONLY shape served to an anonymous browser that concerns tracking,
 * and it is deliberately allow-listed rather than derived: a new server-side
 * secret cannot leak by accident because it is never spread into this object.
 *
 * Exposed:  metaPixelId, metaTrackingEnabled
 * Absent:   MONGODB_URI, SESSION_SECRET, ADMIN_PASSWORD(_HASH),
 *           META_CONVERSIONS_API_ACCESS_TOKEN, and every other env var.
 */
export interface PublicConfigDTO {
  company_name: string;
  welcome_message: string;
  chat_enabled: boolean;
  /** Null when no Pixel is configured. Safe to embed in a script src. */
  meta_pixel_id: string | null;
  meta_tracking_enabled: boolean;
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

/**
 * Build-time-free public configuration.
 *
 * The Pixel ID is re-validated on read as well as on write, so a value that
 * somehow entered the database by another route (a manual insert, an older
 * release) still can never reach the browser as anything but digits. Defence in
 * depth: the write path is the primary gate, this is the second one.
 */
export async function getPublicConfig(): Promise<PublicConfigDTO> {
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  const settings = await getSettings();

  let pixelId: string | null = null;
  if (doc?.metaPixelId) {
    // validateMetaPixelId throws on garbage; a bad stored value must degrade to
    // "tracking off" rather than break the page.
    try {
      pixelId = validateMetaPixelId(doc.metaPixelId);
    } catch {
      pixelId = null;
    }
  }

  return {
    ...settings,
    meta_pixel_id: pixelId,
    meta_tracking_enabled: Boolean(pixelId) && doc?.metaTrackingEnabled === true,
  };
}

/** Admin-facing settings, including the Meta configuration. */
export interface AdminSettingsDTO extends SettingsDTO {
  meta_pixel_id: string | null;
  meta_tracking_enabled: boolean;
}

export async function getAdminSettings(): Promise<AdminSettingsDTO> {
  const doc = await AppSettings.findOne({ key: SETTINGS_KEY }).lean();
  const settings = await getSettings();
  let pixelId: string | null = null;
  if (doc?.metaPixelId) {
    try {
      pixelId = validateMetaPixelId(doc.metaPixelId);
    } catch {
      pixelId = null;
    }
  }
  return {
    ...settings,
    meta_pixel_id: pixelId,
    meta_tracking_enabled: doc?.metaTrackingEnabled === true,
  };
}

export async function updateSettings(input: {
  companyName?: unknown;
  welcomeMessage?: unknown;
  chatEnabled?: unknown;
  metaPixelId?: unknown;
  metaTrackingEnabled?: unknown;
}): Promise<AdminSettingsDTO> {
  const companyName = cleanText(input.companyName, 120);
  const welcomeMessage = cleanText(input.welcomeMessage, 500);
  if (input.chatEnabled !== undefined && typeof input.chatEnabled !== 'boolean') {
    throw badRequest('Invalid value for "Accept new chats".', 'invalid_settings');
  }
  if (
    input.metaTrackingEnabled !== undefined &&
    typeof input.metaTrackingEnabled !== 'boolean'
  ) {
    throw badRequest('Invalid value for "Meta tracking".', 'invalid_settings');
  }

  const update: Record<string, unknown> = {};
  if (companyName) update.companyName = companyName;
  if (welcomeMessage) update.welcomeMessage = welcomeMessage;
  if (typeof input.chatEnabled === 'boolean') update.chatEnabled = input.chatEnabled;

  if (input.metaPixelId !== undefined) {
    // Throws for anything that is not a bare numeric id. An empty value is
    // valid and means "no Pixel configured".
    const pixelId = validateMetaPixelId(input.metaPixelId);
    update.metaPixelId = pixelId;
    // A Pixel can never be enabled without an id, so the toggle is coerced to
    // false rather than storing a contradictory state.
    if (!pixelId && input.metaTrackingEnabled === true) {
      throw badRequest(
        'Enter a Meta Pixel ID before enabling tracking.',
        'meta_pixel_id_required',
      );
    }
  }
  if (typeof input.metaTrackingEnabled === 'boolean') {
    update.metaTrackingEnabled = input.metaTrackingEnabled;
  }

  if (Object.keys(update).length === 0) {
    throw badRequest('Nothing to update.', 'empty_update');
  }

  await AppSettings.updateOne(
    { key: SETTINGS_KEY },
    { $set: update, $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true },
  );

  return getAdminSettings();
}

// -----------------------------------------------------------------------------
// Shared message insert — equivalent of the `handle_new_message` trigger
// -----------------------------------------------------------------------------

/** Media reference snapshot embedded in an image/audio message. */
export interface MessageAttachmentRef {
  attachmentId: Types.ObjectId;
  storageKey: string;
  mimeType: string;
  size: number;
  originalName?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

async function insertMessage(
  conversationId: Types.ObjectId,
  senderType: 'customer' | 'admin',
  text: string,
  senderAdminRef: Types.ObjectId | null,
  clientId?: string | null,
  attachment?: MessageAttachmentRef | null,
  messageType: 'text' | 'image' | 'audio' = 'text',
) {
  const message = await Message.create({
    conversationId,
    senderType,
    senderAdminRef,
    message: text,
    type: messageType,
    attachment: attachment ?? null,
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
  /**
   * Browser-generated Meta event id, replayed through the Conversions API so the
   * browser and server events deduplicate. Optional and untrusted-but-capped: it
   * is only ever used as an opaque string, never to build a query or a path.
   */
  metaEventId?: unknown;
  /** Request-derived technical identifiers, forwarded hashed per Meta's rules. */
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
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

  /**
   * Server-side Conversions API for the StartChat conversion.
   *
   * Fire-and-forget and NOT awaited: a Meta outage must never delay or fail the
   * customer's first message. The `eventId` is the one the browser generated and
   * sent as `meta_event_id`, so Meta deduplicates this against the browser event
   * instead of counting the conversion twice.
   *
   * Nothing here reads message content — only the ad attribution that Meta itself
   * supplied via the click URL.
   */
  /**
   * Merge any stored first-touch attribution onto this conversation.
   *
   * The URL values passed to this function take precedence for a first visit;
   * values captured earlier on the visitor fill anything still blank. Either way
   * the conversation ends up with a complete, durable attribution record.
   */
  await applyAttributionToConversation(visitorRef, conversation._id.toString());

  const browserEventId = cleanText(input.metaEventId, 100);
  if (browserEventId) {
    void sendMetaEvent({
      eventName: META_EVENTS.START_CHAT,
      eventId: browserEventId,
      userData: {
        clientIpAddress: input.clientIpAddress ?? null,
        clientUserAgent: input.clientUserAgent ?? null,
      },
      attribution: attributionFromConversation(conversation),
    });
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

/**
 * send_customer_media_message()
 *
 * Attaches an already-uploaded attachment to a message.
 *
 * The attachment is CLAIMED atomically inside the same logical operation, which
 * is what guarantees a single upload becomes a single message. `claimAttachment`
 * is filtered on `state: 'pending'`, the conversation, the uploader type AND the
 * server-resolved uploader ref — so neither a replayed request, nor a second
 * tab, nor an attacker guessing the attachment id can attach it twice or attach
 * somebody else's upload.
 *
 * Identity comes from the session-resolved `visitorRef` argument, never from the
 * request body.
 */
export async function sendCustomerMediaMessage(
  visitorRef: string,
  conversationId: string,
  input: {
    attachmentId?: unknown;
    /** Optional caption that accompanies the media. */
    message?: unknown;
    clientId?: unknown;
  },
): Promise<{ messageId: string }> {
  const attachmentId = requireObjectId(input.attachmentId, 'attachment id');
  const clientId = cleanText(input.clientId, 100);

  // SECURITY-CRITICAL ownership check against the session visitor.
  const conversation = await Conversation.findOne({ _id: conversationId, visitorRef });
  if (!conversation) {
    throw notFound('Conversation not found.', 'not_your_conversation');
  }
  if (conversation.status === 'closed') {
    throw new ApiError(409, 'conversation_closed', 'This conversation has been closed.');
  }

  // A caption is optional for media, so validate it leniently: empty is fine,
  // but a non-empty caption is still length-capped and control-char stripped.
  const caption = cleanText(input.message, config.attachments.maxCaptionLength) ?? '';

  // Idempotency: an explicit retry must not create a second message. This is
  // checked BEFORE claiming so a retry does not burn the attachment.
  if (clientId) {
    const existing = await Message.findOne({ conversationId, clientId }).lean();
    if (existing) return { messageId: existing._id.toString() };
  }

  const claimed = await claimAttachment({
    attachmentId,
    conversationId,
    uploaderType: 'customer',
    uploaderVisitorRef: visitorRef,
  });
  if (!claimed) {
    // Unknown id, someone else's upload, or already attached. One generic
    // message for all three so the endpoint is not an existence oracle.
    throw notFound('That attachment is no longer available.', 'attachment_not_found');
  }

  try {
    const message = await insertMessage(
      conversation._id,
      'customer',
      caption,
      null,
      clientId,
      {
        attachmentId: claimed._id,
        storageKey: claimed.storageKey,
        mimeType: claimed.mimeType,
        size: claimed.size,
        originalName: claimed.originalName ?? null,
        width: claimed.width ?? null,
        height: claimed.height ?? null,
        durationMs: claimed.durationMs ?? null,
      },
      claimed.kind === 'image' ? 'image' : 'audio',
    );
    return { messageId: message._id.toString() };
  } catch (error) {
    // The message insert failed, so the attachment is now unreferenced. Hand it
    // straight back to 'pending' so a retry with the same clientId can claim it
    // again instead of stranding the file as an orphan.
    await releaseAttachment(claimed._id);
    throw error;
  }
}

/**
 * send_admin_media_message()
 *
 * The admin equivalent, sharing the same claim + insert path so the admin console
 * and the customer chat produce byte-identical message documents. `adminId` is
 * the session-derived admin id (see middleware/auth.ts), never a body field.
 */
export async function sendAdminMediaMessage(
  adminId: string,
  conversationId: string,
  input: { attachmentId?: unknown; message?: unknown; clientId?: unknown },
) {
  const attachmentId = requireObjectId(input.attachmentId, 'attachment id');
  const clientId = cleanText(input.clientId, 100);

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw notFound('Conversation not found.');
  if (conversation.status === 'closed') {
    throw new ApiError(409, 'conversation_closed', 'This conversation is closed. Reopen it to reply.');
  }

  const caption = cleanText(input.message, config.attachments.maxCaptionLength) ?? '';

  if (clientId) {
    const existing = await Message.findOne({ conversationId, clientId }).lean();
    if (existing) return toMessageDTO(existing);
  }

  const adminRef = new Types.ObjectId(adminId);
  const claimed = await claimAttachment({
    attachmentId,
    conversationId,
    uploaderType: 'admin',
    uploaderAdminRef: adminId,
  });
  if (!claimed) {
    throw notFound('That attachment is no longer available.', 'attachment_not_found');
  }

  try {
    const message = await insertMessage(
      conversation._id,
      'admin',
      caption,
      adminRef,
      clientId,
      {
        attachmentId: claimed._id,
        storageKey: claimed.storageKey,
        mimeType: claimed.mimeType,
        size: claimed.size,
        originalName: claimed.originalName ?? null,
        width: claimed.width ?? null,
        height: claimed.height ?? null,
        durationMs: claimed.durationMs ?? null,
      },
      claimed.kind === 'image' ? 'image' : 'audio',
    );

    await ConversationEvent.create({
      conversationId: conversation._id,
      actorRef: adminRef,
      actorType: 'admin',
      eventType: 'status_changed',
      metadata: { note: 'admin_replied' },
    });

    return toMessageDTO(message);
  } catch (error) {
    await releaseAttachment(claimed._id);
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
