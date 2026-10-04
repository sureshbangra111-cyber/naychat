/**
 * Attachment business logic: upload, claim, authorised read and orphan cleanup.
 *
 * IDENTITY RULE (the single most important rule in this file)
 * -----------------------------------------------------------
 * Nothing here ever trusts a `senderId`, `visitorId`, `adminId` or
 * `conversationOwner` supplied by the browser. Callers pass the SERVER-resolved
 * visitor/admin id obtained from the session cookie (see middleware/auth.ts),
 * and every lookup is filtered on it. Changing an id in the request body or the
 * URL therefore changes nothing: the query simply matches no document and the
 * caller gets a 404 — never someone else's media.
 */

import { Types } from 'mongoose';
import { Attachment } from '../../models/Attachment.js';
import { Conversation } from '../../models/Conversation.js';
import { Message } from '../../models/Message.js';
import { config } from '../../config/env.js';
import { ApiError, notFound } from '../../utils/errors.js';
import { getAttachmentStorage } from './storage.js';
import { sanitizeFilename, validateDurationMs, validateMediaUpload } from './validation.js';

export type MediaKind = 'image' | 'audio';

export interface UploadInput {
  conversationId: string;
  /** 'customer' | 'admin' — stamped from the authenticated session. */
  uploaderType: 'customer' | 'admin';
  /** Set only for admins. */
  uploaderAdminRef?: string | null;
  /** Set only for customers; the server-resolved Visitor id. */
  uploaderVisitorRef?: string | null;

  /** Exactly the bytes received from the request stream. */
  buffer: Buffer;
  declaredMime: string;
  declaredFilename: string;
  /** Client-measured recording length; validated and clamped. */
  durationMs?: unknown;
}

export interface AttachmentDTO {
  id: string;
  conversation_id: string;
  kind: MediaKind;
  mime_type: string;
  size: number;
  original_name: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  /** Stable, id-only route. Never a filesystem path. */
  url: string;
  created_at: string;
}

/**
 * Serialises an attachment for the browser.
 *
 * NOTE what is absent: `storageKey`, the conversation's visitor ref and the
 * uploader ref. The browser gets an opaque id and an authorised route to fetch
 * bytes through — nothing that would let it address storage directly.
 */
export function toAttachmentDTO(doc: {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  kind: string;
  mimeType: string;
  size: number;
  originalName?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  createdAt?: Date;
}): AttachmentDTO {
  return {
    id: doc._id.toString(),
    conversation_id: doc.conversationId.toString(),
    kind: doc.kind === 'audio' ? 'audio' : 'image',
    mime_type: doc.mimeType,
    size: doc.size,
    original_name: doc.originalName ?? null,
    width: doc.width ?? null,
    height: doc.height ?? null,
    duration_ms: doc.durationMs ?? null,
    url: `/api/attachments/${doc._id.toString()}`,
    created_at: (doc.createdAt ?? new Date()).toISOString(),
  };
}

/**
 * Stores a validated upload and records its metadata.
 *
 * Ownership is re-verified against the SERVER-resolved visitor inside this
 * function too (not only in the controller), so a future caller cannot skip the
 * check by reaching for this service directly.
 */
export async function createAttachment(input: UploadInput): Promise<AttachmentDTO> {
  const { conversationId, uploaderType } = input;

  // --- Authorisation: the conversation must belong to the session visitor. ---
  if (uploaderType === 'customer') {
    if (!input.uploaderVisitorRef) {
      throw new ApiError(401, 'visitor_required', 'Your chat session has expired.');
    }
    const owned = await Conversation.exists({
      _id: conversationId,
      visitorRef: input.uploaderVisitorRef,
    });
    if (!owned) {
      // 404, not 403 — do not reveal that the conversation exists at all.
      throw notFound('Conversation not found.', 'not_your_conversation');
    }
  } else if (!input.uploaderAdminRef) {
    throw new ApiError(401, 'admin_unauthorized', 'Admin sign-in required.');
  } else if (!(await Conversation.exists({ _id: conversationId }))) {
    throw notFound('Conversation not found.');
  }

  const target = await Conversation.findById(conversationId).select('status').lean();
  if (target?.status === 'closed') {
    throw new ApiError(409, 'conversation_closed', 'This conversation has been closed.');
  }

  // Per-conversation cap: stops a scripted client filling the disk with uploads
  // it never goes on to send.
  const attachmentCount = await Attachment.countDocuments({ conversationId });
  if (attachmentCount >= config.attachments.maxPerConversation) {
    throw new ApiError(
      429,
      'too_many_attachments',
      'This conversation has reached its attachment limit.',
    );
  }

  // The browser declares which kind it thinks it is sending; validation then
  // PROVES it from the bytes and rejects any disagreement.
  const declared = input.declaredMime.toLowerCase();
  const expected: MediaKind =
    declared.startsWith('audio/') || declared.startsWith('video/') ? 'audio' : 'image';

  const detected = validateMediaUpload({
    buffer: input.buffer,
    declaredMime: input.declaredMime,
    declaredFilename: input.declaredFilename,
    expected,
    maxBytes:
      expected === 'image'
        ? config.attachments.maxImageBytes
        : config.attachments.maxAudioBytes,
  });

  const durationMs = detected.kind === 'audio' ? validateDurationMs(input.durationMs) : null;

  const storage = getAttachmentStorage();
  // The extension comes from the DETECTED type, never from the client name.
  const stored = await storage.put(input.buffer, detected.extension);

  const originalName = sanitizeFilename(
    input.declaredFilename,
    detected.kind === 'image' ? `image${detected.extension}` : `voice-message${detected.extension}`,
  );

  try {
    const doc = await Attachment.create({
      conversationId,
      uploaderType,
      uploaderAdminRef: uploaderType === 'admin' ? input.uploaderAdminRef ?? null : null,
      uploaderVisitorRef:
        uploaderType === 'customer' ? input.uploaderVisitorRef ?? null : null,
      kind: detected.kind,
      mimeType: detected.mimeType,
      storageKey: stored.storageKey,
      // Trust the object's own length, not the request header.
      size: stored.size,
      originalName,
      width: detected.width ?? null,
      height: detected.height ?? null,
      durationMs,
      state: 'pending',
    });

    return toAttachmentDTO(doc);
  } catch (error) {
    // The bytes are already stored but no row describes them — remove them now
    // rather than leaving an orphan for the periodic sweep to find later.
    await storage.remove(stored.storageKey);
    throw error;
  }
}

export interface ResolvedAccess {
  attachment: {
    _id: Types.ObjectId;
    conversationId: Types.ObjectId;
    kind: string;
    mimeType: string;
    size: number;
    storageKey: string;
    originalName?: string | null;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
  };
  viewer: 'customer' | 'admin';
}

/**
 * Resolves an attachment id to its metadata IF AND ONLY IF the caller may see it.
 *
 * Returns null for every failure mode (unknown id, someone else's attachment) so
 * the controller can answer with one uniform 404 and never confirm the existence
 * of another visitor's media.
 *
 * CUSTOMER: `Conversation.exists({ _id, visitorRef })` where visitorRef comes from
 * the session cookie — never from the request.
 * ADMIN: any valid admin session.
 */
export async function authorizeAttachmentRead(
  attachmentId: string,
  access: { visitorId?: string | null; isAdmin: boolean },
): Promise<ResolvedAccess | null> {
  const found = await Attachment.findById(attachmentId)
    .select('conversationId kind mimeType size storageKey originalName durationMs width height')
    .lean();
  if (!found) return null;

  if (access.isAdmin) {
    return { attachment: found as ResolvedAccess['attachment'], viewer: 'admin' };
  }

  if (!access.visitorId) return null;

  // The ownership check is on the CONVERSATION, joined to the session visitor.
  // Possessing an attachment id is therefore worthless without the session that
  // owns the conversation it belongs to — this is what stops visitor B reading
  // visitor A's image by editing the id in the URL.
  const owns = await Conversation.exists({
    _id: found.conversationId,
    visitorRef: access.visitorId,
  });
  if (!owns) return null;

  return { attachment: found as ResolvedAccess['attachment'], viewer: 'customer' };
}

/** The shape `claimAttachment` resolves to, once a pending row is locked in. */
export interface ClaimedAttachment {
  _id: Types.ObjectId;
  storageKey: string;
  kind: string;
  mimeType: string;
  size: number;
  originalName?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

/**
 * Atomically claims a PENDING attachment for a message.
 *
 * `findOneAndUpdate` with `state: 'pending'` is what stops one upload from being
 * referenced by two different messages (e.g. a double-submitted form) — the same
 * idempotency guarantee the text path gets from the unique
 * `(conversationId, clientId)` index.
 *
 * Returns null when the attachment does not exist, is already claimed, belongs to
 * a different conversation, or was uploaded by a different session than the one
 * trying to claim it.
 */
export async function claimAttachment(options: {
  attachmentId: string;
  conversationId: string;
  /** The caller must be the uploader: an admin cannot attach a customer's upload. */
  uploaderType: 'customer' | 'admin';
  uploaderAdminRef?: string | null;
  uploaderVisitorRef?: string | null;
}): Promise<ClaimedAttachment | null> {
  const filter: Record<string, unknown> = {
    _id: options.attachmentId,
    conversationId: options.conversationId,
    uploaderType: options.uploaderType,
    state: 'pending',
  };
  // Bind the claim to the exact session that performed the upload.
  if (options.uploaderType === 'admin') {
    filter.uploaderAdminRef = options.uploaderAdminRef ?? null;
  } else {
    filter.uploaderVisitorRef = options.uploaderVisitorRef ?? null;
  }

  return Attachment.findOneAndUpdate(
    filter,
    { $set: { state: 'attached', attachedAt: new Date() } },
    // `returnDocument: 'after'` instead of the deprecated `new: true`, matching
    // the convention already used in setConversationStatus().
    { returnDocument: 'after' },
  )
    .select('storageKey kind mimeType size originalName width height durationMs')
    .lean();
}

/**
 * Returns a claimed attachment to the 'pending' pool after a failed message
 * insert. Scoped to `state: 'attached'` so it can never un-claim an attachment
 * that some other request already attached to a real message.
 */
export async function releaseAttachment(attachmentId: Types.ObjectId): Promise<void> {
  await Attachment.updateOne(
    { _id: attachmentId, state: 'attached' },
    { $set: { state: 'pending', attachedAt: null } },
  );
}

/**
 * Deletes an attachment that was uploaded but never attached to a message — the
 * user picked an image, saw the preview, then navigated away or cancelled.
 *
 * Only a PENDING attachment owned by the caller's own session can be deleted, so
 * this can never be used to destroy media that is part of the conversation.
 */
export async function discardPendingAttachment(options: {
  attachmentId: string;
  uploaderType: 'customer' | 'admin';
  uploaderAdminRef?: string | null;
  uploaderVisitorRef?: string | null;
}): Promise<boolean> {
  const filter: Record<string, unknown> = {
    _id: options.attachmentId,
    uploaderType: options.uploaderType,
    state: 'pending',
  };
  if (options.uploaderType === 'admin') {
    filter.uploaderAdminRef = options.uploaderAdminRef ?? null;
  } else {
    filter.uploaderVisitorRef = options.uploaderVisitorRef ?? null;
  }

  const removed = await Attachment.findOneAndDelete(filter).select('storageKey').lean();
  if (!removed) return false;

  await getAttachmentStorage().remove(removed.storageKey);
  return true;
}

/**
 * ORPHAN CLEANUP
 *
 * An upload that succeeded but whose message was never created leaves a stored
 * object and a `pending` row behind. This sweep removes both once the row is older
 * than ATTACHMENT_ORPHAN_TTL_MS. Two safety valves stop it ever deleting live media:
 *   * only `state: 'pending'` rows are eligible, and
 *   * rows a message already references are re-checked and skipped, so a crash
 *     between the claim and the message insert cannot lose anything.
 */
export async function sweepOrphanAttachments(): Promise<{
  rowsDeleted: number;
  filesDeleted: number;
}> {
  const cutoff = new Date(Date.now() - config.attachments.orphanTtlMs);
  const candidates = await Attachment.find({ state: 'pending', createdAt: { $lt: cutoff } })
    .select('_id storageKey')
    .lean();
  if (candidates.length === 0) return { rowsDeleted: 0, filesDeleted: 0 };

  const referenced = await Message.distinct('attachment.attachmentId', {
    'attachment.attachmentId': { $in: candidates.map((c) => c._id) },
  });
  const referencedIds = new Set(referenced.map((id) => id.toString()));

  const doomed = candidates.filter((c) => !referencedIds.has(c._id.toString()));
  if (doomed.length === 0) return { rowsDeleted: 0, filesDeleted: 0 };

  const storage = getAttachmentStorage();
  for (const row of doomed) {
    await storage.remove(row.storageKey);
  }
  // Scoped to the exact ids just unlinked, so a message created in the meantime
  // is not caught by the delete.
  const result = await Attachment.deleteMany({
    _id: { $in: doomed.map((d) => d._id) },
    state: 'pending',
  });

  return { rowsDeleted: result.deletedCount ?? 0, filesDeleted: doomed.length };
}

/**
 * Removes the stored object behind an attachment. Exposed so a future
 * delete-message endpoint can reuse it; nothing calls it today because message
 * deletion is not a feature of this app.
 */
export async function deleteStoredObject(storageKey: string): Promise<void> {
  await getAttachmentStorage().remove(storageKey);
}

/** Bytes currently held in attachment storage. Surfaced by /api/health. */
export async function attachmentUsageBytes(): Promise<number> {
  return getAttachmentStorage().usageBytes();
}
