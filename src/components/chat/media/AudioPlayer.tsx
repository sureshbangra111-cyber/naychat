import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatDuration } from '../../../hooks/useAudioRecorder';

interface Props {
  src: string;
  /** Authoritative duration from the server, in ms. */
  durationMs?: number | null;
  /** Playback rate for the synthetic "1x" label. */
  compact?: boolean;
  label: string;
  onError?: () => void;
}

/**
 * Voice-message bubble: [play] [waveform] [0:08].
 *
 * Streams through the authorised `/api/attachments/:id` route, so nothing is
 * downloaded eagerly: the browser fetches metadata, issues Range requests while
 * seeking, and never pulls the whole file just to play it. No autoplay — the user
 * must press play, which is also what browsers require for audio with sound.
 *
 * The waveform bars are a STATIC visual index derived from the known duration,
 * not recorded amplitude: we only have the duration server-side, so pretending
 * these bars are the real recorded waveform would be a lie. The filled portion
 * tracks genuine playback progress, and the seek bar is fully interactive.
 */
export function AudioPlayer({ src, durationMs, compact = false, label, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(durationMs ?? 0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const BAR_COUNT = compact ? 22 : 32;

  // The browser's own duration is authoritative once metadata loads — it is
  // usually a fraction of a second off the client's stopwatch.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setTotalMs(Math.round(audio.duration * 1000));
      }
      setLoading(false);
    };
    const onTime = () => setCurrentMs(Math.round(audio.currentTime * 1000));
    const onEnded = () => {
      setPlaying(false);
      setCurrentMs(0);
    };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => {
      setPlaying(true);
      setLoading(false);
    };
    const onError = () => {
      setFailed(true);
      setLoading(false);
      setPlaying(false);
      onError?.();
    };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onLoaded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onLoaded);
      audio.removeEventListener('error', onError);
    };
  }, [onError]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (audio.paused) {
      setLoading(true);
      void audio.play().catch(() => {
        setLoading(false);
        setFailed(true);
      });
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [failed]);

  const seek = useCallback(
    (event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || totalMs <= 0) return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const clientX = 'clientX' in event ? event.clientX : null;
      if (clientX === null) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      audio.currentTime = (ratio * totalMs) / 1000;
      setCurrentMs(Math.round(ratio * totalMs));
    },
    [totalMs],
  );

  const onSeekKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || totalMs <= 0) return;
      const stepMs = 5000;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        audio.currentTime = Math.min(totalMs, audio.currentTime * 1000 + stepMs) / 1000;
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime * 1000 - stepMs) / 1000;
      } else if (event.key === 'Home') {
        event.preventDefault();
        audio.currentTime = 0;
      }
    },
    [totalMs],
  );

  const progress = totalMs > 0 ? Math.min(1, currentMs / totalMs) : 0;
  const remaining = totalMs > 0 ? Math.max(0, totalMs - currentMs) : 0;

  // Preload metadata only: enough to know the duration, not enough to download
  // the audio. `crossOrigin` is deliberately unset — the route is same-origin.
  return (
    <div className={cn('flex items-center gap-3', compact ? 'min-w-[190px]' : 'min-w-[220px]')}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        onClick={toggle}
        disabled={failed}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          failed
            ? 'cursor-not-allowed bg-slate-300 text-slate-500'
            : 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
        )}
      >
        {failed ? (
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        ) : loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : playing ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label={`Seek ${label}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(totalMs / 1000)}
          aria-valuenow={Math.round(currentMs / 1000)}
          aria-valuetext={`${formatDuration(currentMs)} of ${formatDuration(totalMs)}`}
          onClick={seek}
          onKeyDown={onSeekKey}
          className={cn(
            'flex h-6 w-full cursor-pointer items-center gap-[2px] rounded px-0.5',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          {Array.from({ length: BAR_COUNT }, (_, index) => {
            const filled = index / BAR_COUNT < progress;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={cn(
                  'h-full w-full rounded-full transition-colors',
                  filled ? 'bg-brand-600' : 'bg-brand-200',
                )}
                style={{
                  // Gentle, symmetric bar profile for a calm, readable look.
                  height: `${45 + ((index * 37) % 55)}%`,
                }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] tabular-nums">
          <span className={cn(failed ? 'text-rose-600' : 'text-slate-500')}>
            {failed ? 'Could not play' : formatDuration(totalMs)}
          </span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Volume2 className="h-3 w-3" aria-hidden="true" />
            {formatDuration(remaining)}
          </span>
        </div>
      </div>

      {/* Screen-reader state that the visual UI does not convey on its own. */}
      <span className="sr-only" aria-live="polite">
        {failed ? `${label} could not be played.` : playing ? `Playing ${label}.` : ''}
      </span>
    </div>
  );
}
