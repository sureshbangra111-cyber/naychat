import { useEffect, useState } from 'react';
import { ImageIcon, Loader2, Send, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatBytes } from '../../../hooks/useAudioRecorder';

interface Props {
  file: File;
  /** Local object URL for the thumbnail. */
  previewUrl: string;
  /** 0-100 while uploading, null before the upload starts. */
  uploadProgress: number | null;
  uploading: boolean;
  error: string | null;
  disabled?: boolean;
  onCancel: () => void;
  onSend: () => void;
}

/**
 * Attachment preview shown ABOVE the composer, between picking a file and
 * sending it. Gives the user a real chance to cancel before anything is
 * uploaded, so an accidental selection costs nothing.
 *
 * The thumbnail comes from a local blob URL, not from the server — nothing has
 * been uploaded at this point, and the object URL is revoked on unmount.
 */
export function AttachmentPreview({
  file,
  previewUrl,
  uploadProgress,
  uploading,
  error,
  disabled = false,
  onCancel,
  onSend,
}: Props) {
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  // Read the real dimensions locally so the layout is correct before upload and
  // the server's stored width/height can be trusted on the way back.
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setNaturalWidth(image.naturalWidth);
      setNaturalHeight(image.naturalHeight);
    };
    image.src = previewUrl;
    return () => {
      image.onload = null;
    };
  }, [previewUrl]);

  const dimensions =
    naturalWidth && naturalHeight ? `${naturalWidth} × ${naturalHeight}` : null;

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      <div className="flex items-start gap-3 p-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          <img
            src={previewUrl}
            alt={file.name ? `Preview of ${file.name}` : 'Selected image preview'}
            className="h-full w-full object-cover"
          />
          {uploading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden="true" />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                {/* Rendered as a text node — a filename can never become markup. */}
                <span className="truncate">{file.name || 'Image'}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatBytes(file.size)}
                {dimensions ? ` · ${dimensions}` : ''}
              </p>
            </div>

            <button
              type="button"
              onClick={onCancel}
              disabled={uploading}
              aria-label="Remove selected image"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {uploading && uploadProgress !== null ? (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Uploading…</span>
                <span className="tabular-nums">{uploadProgress}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={uploadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Image upload progress"
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
              >
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width] duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={uploading}
          className={cn(
            'h-10 rounded-xl px-3.5 text-sm font-medium text-slate-600 transition-colors',
            'hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={uploading || disabled}
          aria-label="Send image"
          className={cn(
            'flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white',
            'transition-colors hover:bg-brand-700 active:bg-brand-800',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'disabled:cursor-not-allowed disabled:bg-slate-300',
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {uploading ? 'Uploading…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
