import { useState } from 'react';
import { AlertCircle, Check, CheckCheck, Clock, RotateCcw } from 'lucide-react';
import { cn, formatTime } from '../../lib/utils';
import type { DisplayMessage } from '../../types/chat';
import { ImageThumbnail, ImageViewer } from './media/ImageViewer';
import { AudioPlayer } from './media/AudioPlayer';

interface Props {
  message: DisplayMessage;
  /** Whose view this is — controls bubble alignment. */
  self: 'customer' | 'admin';
  onDiscard?: (id: string) => void;
  onRetry?: (id: string) => void;
}

/**
 * A single message bubble.
 *
 * Renders three kinds, chosen by `message.type`:
 *   text  -> a plain text node (unchanged behaviour, no HTML ever interpreted)
 *   image -> a thumbnail that opens the full-screen viewer
 *   audio -> an inline player with a waveform and duration
 *
 * SECURITY: message text and the attachment filename are rendered as React text
 * nodes. No `dangerouslySetInnerHTML`, no Markdown/HTML parsing — customer input
 * can never be interpreted as markup. Media is loaded through the authorised
 * `/api/attachments/:id` route, which re-checks session ownership on every hit.
 */
export function MessageBubble({ message, self, onDiscard, onRetry }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);

  const isPending = 'pending' in message;
  const failed = isPending && message.failed;
  const isSelf = message.sender_type === self;
  const read = !isPending && message.read_at !== null;

  const attachment = message.attachment;
  const isImage = message.type === 'image';
  const isAudio = message.type === 'audio';
  const hasText = message.message.length > 0;

  // While a media message is uploading, show the real progress.
  const progress = isPending ? message.uploadProgress : null;
  const uploading = isPending && progress !== null;

  // Prefer the local blob preview while pending; fall back to the authorised URL.
  const previewUrl = isPending ? message.previewUrl : null;
  const mediaSrc = previewUrl ?? attachment?.url ?? null;

  // A caption is the accessible description for an image; fall back to the
  // original filename so assistive tech never gets an empty label.
  const imageAlt = hasText
    ? message.message
    : attachment?.original_name
      ? `Image: ${attachment.original_name}`
      : 'Image sent in the chat';

  return (
    <>
      <div className={cn('flex w-full px-3', isSelf ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'flex min-w-0 max-w-[82%] flex-col sm:max-w-[68%]',
            isSelf ? 'items-end' : 'items-start',
          )}
        >
          {/* Media-only bubbles get a tighter frame than text bubbles. */}
          {(isImage || isAudio) && (
            <div
              className={cn(
                'overflow-hidden rounded-2xl shadow-sm',
                isSelf ? 'rounded-br-md' : 'rounded-bl-md',
                failed && 'ring-2 ring-rose-300',
              )}
            >
              {isImage && mediaSrc ? (
                <ImageThumbnail
                  src={mediaSrc}
                  alt={imageAlt}
                  width={attachment?.width}
                  height={attachment?.height}
                  onOpen={() => setViewerOpen(true)}
                />
              ) : isAudio && mediaSrc ? (
                <div
                  className={cn(
                    'px-3 py-2.5',
                    isSelf ? 'bg-brand-600' : 'border border-slate-200 bg-white',
                  )}
                >
                  <AudioPlayer
                    src={mediaSrc}
                    durationMs={attachment?.duration_ms}
                    label={`voice message from ${message.sender_type}`}
                  />
                </div>
              ) : (
                <div
                  className={cn(
                    'px-3.5 py-3 text-sm',
                    isSelf ? 'bg-brand-600 text-white/90' : 'bg-white text-slate-500',
                  )}
                >
                  {isImage ? 'Image unavailable' : 'Voice message unavailable'}
                </div>
              )}
            </div>
          )}

          {/* Caption, when there is one. */}
          {hasText ? (
            <div
              className={cn(
                'text-[15px] leading-relaxed shadow-sm',
                'whitespace-pre-wrap break-words',
                // When there is media above, the caption sits tight under it.
                (isImage || isAudio) ? 'mt-1 px-1' : 'rounded-2xl px-3.5 py-2.5',
                (isImage || isAudio)
                  ? isSelf
                    ? 'rounded-br-md'
                    : 'rounded-bl-md'
                  : isSelf
                    ? 'rounded-br-md bg-brand-600 text-white'
                    : 'rounded-bl-md border border-slate-200 bg-white text-slate-800',
                failed && 'bg-rose-600 text-white',
              )}
            >
              {message.message}
            </div>
          ) : null}

          {/* Upload progress: real XHR percentage, then "Sending…". */}
          {isPending && !failed ? (
            <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
              {uploading && progress !== null ? (
                <>
                  <span
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Upload progress"
                    className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"
                  >
                    <span
                      className="block h-full rounded-full bg-brand-500 transition-[width] duration-150"
                      style={{ width: `${progress}%` }}
                    />
                  </span>
                  <span className="tabular-nums">Uploading… {progress}%</span>
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>Sending…</span>
                </>
              )}
            </div>
          ) : null}

          <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
            <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>

            {failed ? (
              <>
                <AlertCircle className="h-3 w-3 text-rose-500" aria-hidden="true" />
                <span className="text-rose-500">Not sent</span>
                {onRetry ? (
                  <button
                    type="button"
                    onClick={() => void onRetry(message.id)}
                    className="inline-flex items-center gap-0.5 font-medium text-rose-600 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    Retry
                  </button>
                ) : null}
                {onDiscard ? (
                  <button
                    type="button"
                    onClick={() => onDiscard(message.id)}
                    className="font-medium text-rose-600 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Discard
                  </button>
                ) : null}
              </>
            ) : isPending ? null : isSelf ? (
              read ? (
                <>
                  <CheckCheck className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Read</span>
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Sent</span>
                </>
              )
            ) : null}
          </div>
        </div>
      </div>

      {/* Full-screen viewer. Only mounted when open, so no extra image fetch. */}
      {viewerOpen && isImage && mediaSrc ? (
        <ImageViewer
          src={mediaSrc}
          alt={imageAlt}
          filename={attachment?.original_name}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </>
  );
}
