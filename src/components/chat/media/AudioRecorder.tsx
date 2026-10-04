import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatBytes, formatDuration, type RecordingResult } from '../../../hooks/useAudioRecorder';

interface Props {
  status: 'idle' | 'requesting' | 'recording' | 'stopped' | 'error';
  elapsedMs: number;
  /** Live RMS per bar, 0..1. Real analyser output — see useAudioRecorder. */
  levels: number[];
  error: string | null;
  mimeType: string | null;
  /** The finished recording awaiting send, if any. */
  result: RecordingResult | null;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onDiscard: () => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
}

/**
 * Recording UI.
 *
 * Replaces the normal composer while recording, exactly like a modern mobile
 * messenger:
 *
 *   Recording  [pulsing red dot]  0:07   [ Cancel ] [ Stop ]
 *   (after stop) [ ▶ Preview ]  0:08    [ Delete ] [ Send ]
 *
 * The waveform is drawn from `levels`, which the recorder fills from an
 * AnalyserNode reading the live microphone. There is no synthetic animation.
 *
 * Accessibility: the elapsed timer is in an `aria-live="polite"` region so a
 * screen reader announces recording start/stop, and every control has an
 * explicit label plus a visible focus ring.
 */
export function AudioRecorder({
  status,
  elapsedMs,
  levels,
  error,
  mimeType,
  result,
  onStart,
  onStop,
  onCancel,
  onDiscard,
  onSend,
  sending,
  disabled = false,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);

  // Build a local URL for the finished recording so the user can listen back
  // BEFORE uploading it. Revoked whenever the recording is replaced or discarded.
  useEffect(() => {
    if (!result) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  const recording = status === 'recording';
  const requesting = status === 'requesting';
  const previewing = status === 'stopped' && result !== null;

  return (
    <div className="border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {error ? (
        <p role="alert" className="mb-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      {previewing && previewUrl ? (
        /* ---------- AFTER STOP: preview / delete / send ---------- */
        <div className="space-y-2.5">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-2.5">
            <button
              type="button"
              onClick={() => {
                const audio = previewRef.current;
                if (!audio) return;
                if (audio.paused) void audio.play().catch(() => undefined);
                else audio.pause();
              }}
              aria-label="Play recording preview"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Mic className="h-4 w-4" aria-hidden="true" />
            </button>
            <audio ref={previewRef} src={previewUrl} controls className="h-9 min-w-0 flex-1" />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {formatDuration(result.durationMs)} · {formatBytes(result.blob.size)}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onDiscard}
              disabled={sending}
              aria-label="Delete recording"
              className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={sending || disabled}
              aria-label="Send voice message"
              className="flex h-11 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      ) : (
        /* ---------- WHILE RECORDING (or requesting) ---------- */
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl bg-rose-50 px-3 py-3">
            <span
              className={cn(
                'flex h-3 w-3 shrink-0 items-center justify-center',
                recording ? 'animate-pulse' : '',
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  'h-3 w-3 rounded-full',
                  requesting ? 'bg-amber-400' : recording ? 'bg-rose-500' : 'bg-slate-300',
                )}
              />
            </span>

            <span className="text-sm font-semibold text-rose-700">
              {requesting ? 'Starting…' : 'Recording'}
            </span>

            {/* Live waveform from real analyser data. */}
            <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px]" aria-hidden="true">
              {(levels.length > 0 ? levels : new Array(32).fill(0)).map((level, index) => (
                <span
                  key={index}
                  className="w-full rounded-full bg-rose-400 transition-[height] duration-75"
                  style={{ height: `${Math.max(8, level * 100)}%` }}
                />
              ))}
            </div>

            <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-700">
              {formatDuration(elapsedMs)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel recording"
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </button>

            {recording ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop recording"
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 text-sm font-semibold text-white transition-colors hover:bg-rose-700 active:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                disabled={requesting || disabled}
                aria-label="Start recording"
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              >
                {requesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
                {requesting ? 'Starting…' : 'Record'}
              </button>
            )}
          </div>

          {mimeType ? (
            <p className="text-center text-[11px] text-slate-400">
              Recording in {mimeType.split(';')[0]}
            </p>
          ) : null}
        </div>
      )}

      {/* Announces recording state changes to screen readers. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {recording ? `Recording. ${formatDuration(elapsedMs)} elapsed.` : ''}
        {previewing ? `Recording finished. ${formatDuration(result.durationMs)} long.` : ''}
      </p>
    </div>
  );
}
