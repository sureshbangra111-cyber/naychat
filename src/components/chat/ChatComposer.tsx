import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Mic, SendHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MAX_MESSAGE_LENGTH, type MessageType } from '../../types/chat';
import { fetchAttachmentLimits } from '../../services/messages';
import { useAudioRecorder, type RecordingResult } from '../../hooks/useAudioRecorder';
import { AttachmentPreview } from './media/AttachmentPreview';
import { AudioRecorder } from './media/AudioRecorder';

/** Image types the UI will even offer to upload; the server verifies bytes. */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface MediaSendInput {
  file: File | Blob;
  filename: string;
  kind: 'image' | 'audio';
  durationMs?: number | null;
  caption?: string;
}

interface Props {
  onSend: (text: string) => Promise<boolean>;
  /** Media send. Returns false when the server rejected it. */
  onSendMedia?: (input: MediaSendInput) => Promise<boolean>;
  disabled?: boolean;
  disabledHint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** 'customer' themes the send button; 'admin' stays neutral. */
  side?: 'customer' | 'admin';
}

type Mode = 'idle' | 'previewing' | 'recording';

/**
 * Message composer.
 *
 * LAYOUT: [ + / image ] [ input ] [ mic -> send ]
 *
 * The right-hand control swaps by state, which is what makes the bar feel like a
 * native messenger:
 *   * empty input        -> microphone
 *   * text entered       -> send
 *   * image selected     -> preview panel above, send in the panel
 *   * recording          -> the whole composer is replaced by recording controls
 *
 * Keyboard: Enter sends, Shift+Enter inserts a newline on a desktop keyboard.
 * `enterkeyhint` and the auto-growing textarea keep the mobile keyboard from
 * covering the composer or resizing the layout.
 *
 * Accessibility: every icon button has an aria-label and a visible focus ring, the
 * file input is a real (visually hidden) `<input type="file">` reachable by
 * keyboard, and the upload progress is a labelled progressbar.
 */
export function ChatComposer({
  onSend,
  onSendMedia,
  disabled = false,
  disabledHint,
  placeholder = 'Type your message...',
  autoFocus = false,
  side = 'customer',
}: Props) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingResult | null>(null);
  const [maxImageBytes, setMaxImageBytes] = useState(10 * 1024 * 1024);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const recorder = useAudioRecorder();

  // Ask the server for its real limits rather than hardcoding a number that could
  // drift from the enforced value.
  useEffect(() => {
    let active = true;
    void fetchAttachmentLimits().then((limits) => {
      if (active) setMaxImageBytes(limits.image_max_bytes);
    });
    return () => {
      active = false;
    };
  }, []);

  // Auto-grow up to ~6 lines, then scroll internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [value]);

  useEffect(() => {
    if (!disabled && autoFocus) textareaRef.current?.focus();
  }, [disabled, autoFocus]);

  // Release the last object URL so the blob is not retained after unmount.
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const trimmed = value.trim();
  const canSendText = trimmed.length > 0 && !sending && !disabled;
  const mediaEnabled = Boolean(onSendMedia) && !disabled && !sending;

  const clearImage = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setSelectedImage(null);
    setPreviewUrl(null);
    setUploadProgress(null);
    setMediaError(null);
    setMode('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSendText = useCallback(async () => {
    if (!canSendText) return;
    const text = trimmed;
    setSending(true);
    try {
      const ok = await onSend(text);
      if (ok) {
        setValue('');
        textareaRef.current?.focus();
      }
    } finally {
      setSending(false);
    }
  }, [canSendText, trimmed, onSend]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      // On a desktop keyboard Enter sends; on touch keyboards enterkeyhint hints
      // the same. Shift+Enter always means a newline.
      event.preventDefault();
      void handleSendText();
    }
  };

  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMediaError(null);

    // Client-side pre-checks only, to save the user a pointless round trip. The
    // server re-validates the actual bytes regardless.
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setMediaError('Only JPG, PNG, WEBP and GIF images can be sent.');
      event.target.value = '';
      return;
    }
    if (file.size > maxImageBytes) {
      setMediaError(`That image is larger than ${Math.round(maxImageBytes / 1024 / 1024)}MB.`);
      event.target.value = '';
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setSelectedImage(file);
    setPreviewUrl(url);
    setUploadProgress(null);
    setMode('previewing');
    event.target.value = '';
  };

  const handleSendImage = async () => {
    if (!selectedImage || !onSendMedia || sending) return;
    setSending(true);
    setMediaError(null);
    setUploadProgress(0);
    try {
      // Progress is surfaced by the bubble's own progressbar; the panel just
      // shows a spinner alongside the percentage the hook produced.
      const ok = await onSendMedia({
        file: selectedImage,
        filename: selectedImage.name || 'image',
        kind: 'image',
      });
      if (ok) {
        clearImage();
        textareaRef.current?.focus();
      } else {
        setUploadProgress(null);
      }
    } finally {
      // finally, not the success path: a rejection must never leave the whole
      // composer stuck in its loading state.
      setSending(false);
    }
  };

  // --- Recording controls ---------------------------------------------------

  const startRecording = async () => {
    // Never begin a recording while a previous send is still in flight: the two
    // flows share `sending`, and starting one mid-send would leave the recording
    // UI's Send button permanently disabled.
    if (sending || !onSendMedia || disabled) return;
    setMediaError(null);
    setMode('recording');
    try {
      // `start()` resolves only when the user stops, so we deliberately do not
      // await it here.
      void recorder.start().then((result) => {
        setRecording(result);
      });
    } catch {
      setMode('idle');
      // The hook already surfaced a user-safe message in `recorder.state.error`.
    }
  };

  const stopRecording = () => recorder.stop();

  const cancelRecording = () => {
    recorder.cancel();
    setRecording(null);
    setMode('idle');
    setMediaError(null);
  };

  const discardRecording = () => {
    recorder.reset();
    setRecording(null);
    setMode('idle');
    setMediaError(null);
  };

  const sendRecording = async () => {
    if (!recording || !onSendMedia || sending) return;
    setSending(true);
    setMediaError(null);
    try {
      const ok = await onSendMedia({
        file: recording.blob,
        // The extension matches the container MediaRecorder actually produced.
        filename: `voice-message${recording.extension}`,
        kind: 'audio',
        durationMs: recording.durationMs,
      });
      if (ok) {
        discardRecording();
        textareaRef.current?.focus();
      }
    } finally {
      setSending(false);
    }
  };

  if (disabled) {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500">
        {disabledHint ?? 'This conversation is closed.'}
      </div>
    );
  }

  // The recording UI replaces the whole composer while active.
  if (mode === 'recording') {
    return (
      <AudioRecorder
        status={recorder.state.status}
        elapsedMs={recorder.state.elapsedMs}
        levels={recorder.state.levels}
        error={recorder.state.error ?? mediaError}
        mimeType={recorder.state.mimeType}
        result={recording}
        sending={sending}
        disabled={disabled}
        onStart={startRecording}
        onStop={stopRecording}
        onCancel={cancelRecording}
        onDiscard={discardRecording}
        onSend={() => void sendRecording()}
      />
    );
  }

  const sendButtonClass = cn(
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
    'disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400',
    side === 'customer'
      ? 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800'
      : 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950',
  );

  return (
    <div className="border-t border-slate-200 bg-white">
      {/* ---- Attachment preview panel sits ABOVE the input row ---- */}
      {mode === 'previewing' && selectedImage && previewUrl ? (
        <div className="pt-3">
          <AttachmentPreview
            file={selectedImage}
            previewUrl={previewUrl}
            uploadProgress={uploadProgress}
            uploading={sending}
            error={mediaError}
            onCancel={clearImage}
            onSend={() => void handleSendImage()}
          />
        </div>
      ) : null}

      {/* Errors raised while no preview panel is open (e.g. a rejected file type)
          still need a visible, announced home. */}
      {mediaError && mode !== 'previewing' ? (
        <p role="alert" className="mx-3 mb-1 text-xs text-rose-600">
          {mediaError}
        </p>
      ) : null}

      <div className="flex items-end gap-1.5 px-2 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* ---- Attachment button + hidden file input ---- */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!mediaEnabled}
          aria-label="Send an image"
          aria-haspopup="dialog"
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
            'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'disabled:cursor-not-allowed disabled:text-slate-300',
          )}
        >
          <ImagePlus className="h-5 w-5" aria-hidden="true" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={handleFilePicked}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* ---- Text input ---- */}
        <label htmlFor="chat-composer" className="sr-only">
          {placeholder}
        </label>
        <textarea
          id="chat-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (mediaError) setMediaError(null);
          }}
          onKeyDown={handleKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={placeholder}
          disabled={sending}
          enterKeyHint="send"
          className="scroll-slim max-h-36 min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
        />

        {/* ---- Mic when empty, send when there is text ---- */}
        {canSendText ? (
          <button
            type="button"
            onClick={() => void handleSendText()}
            className={sendButtonClass}
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        ) : sending ? (
          /* A send is in flight: show progress only, and never offer the mic,
             so a second send cannot be started on top of the first. */
          <span
            role="status"
            aria-label="Sending"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-600"
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={!onSendMedia || disabled}
            aria-label="Record a voice message"
            title={onSendMedia ? 'Record a voice message' : 'Voice messages are unavailable'}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
              'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              'disabled:cursor-not-allowed disabled:text-slate-300',
            )}
          >
            <Mic className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between px-3 pb-1 text-[11px] text-slate-400">
        <span aria-live="polite">
          {sending ? 'Sending…' : 'Enter to send · Shift + Enter for a new line'}
        </span>
        {value.length > MAX_MESSAGE_LENGTH - 400 ? (
          <span className={value.length > MAX_MESSAGE_LENGTH - 100 ? 'text-rose-500' : ''}>
            {value.length}/{MAX_MESSAGE_LENGTH}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export type { MessageType };
