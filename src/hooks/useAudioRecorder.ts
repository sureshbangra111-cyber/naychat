/**
 * Voice recording via the browser's native MediaRecorder API.
 *
 * FORMAT DETECTION
 * We ask `MediaRecorder.isTypeSupported` what the browser can actually encode and
 * pick the best option, preferring `audio/webm;codecs=opus`. The blob's real type
 * is read back from the recorder instance (`recorder.mimeType`) rather than
 * assumed, and the file extension is derived from it — so the server never
 * receives a filename whose extension contradicts the bytes.
 *
 * WAVEFORM
 * Bars are driven by a real AnalyserNode reading the live microphone stream
 * (getByteTimeDomainData -> RMS). Nothing is faked or randomised: silence gives
 * flat bars, speech gives movement.
 *
 * PRIVACY
 * Recording starts only from an explicit user gesture, every stream track is
 * stopped on cancel, and the AudioContext is closed. No audio leaves the device
 * until the user sends it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Preference order, best first. Each entry is probed with isTypeSupported. */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

/** Number of waveform bars rendered in the recording UI. */
const BAR_COUNT = 32;

export interface RecordingResult {
  blob: Blob;
  /** Extension matching the real container, e.g. `.webm`. Never guessed. */
  extension: string;
  /** Measured length in milliseconds. */
  durationMs: number;
}

/** Picks the best container this browser can encode, or null if it can do none. */
export function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of PREFERRED_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* some engines throw on an unknown type — keep probing */
    }
  }
  return null;
}

/** Maps a real MIME type to an extension the server's validator allows. */
function extensionForMime(mimeType: string): string {
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('mp4')) return '.m4a';
  if (mimeType.includes('mpeg')) return '.mp3';
  if (mimeType.includes('wav')) return '.wav';
  return '.webm';
}

/** `m:ss` for the elapsed-timer display. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `12 KB` / `3.4 MB` for attachment previews. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error';

export interface RecorderState {
  status: RecorderStatus;
  elapsedMs: number;
  /** Live RMS values in 0..1, one per bar. */
  levels: number[];
  error: string | null;
  /** The MIME type actually chosen by the browser. */
  mimeType: string | null;
}

const IDLE_LEVELS = new Array<number>(BAR_COUNT).fill(0);

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>({
    status: 'idle',
    elapsedMs: 0,
    levels: IDLE_LEVELS,
    error: null,
    mimeType: null,
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  // Settled by the recorder's onstop, resolving the promise returned by start().
  const finishRef = useRef<((result: RecordingResult) => void) | null>(null);

  /** Releases the microphone and every derived audio node. */
  const teardown = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Stopping every track is what turns off the browser's recording indicator.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }, []);

  // Unmount safety: never leave the microphone live after the view unmounts.
  useEffect(() => teardown, [teardown]);

  /** Starts recording; the returned promise resolves with the audio on stop(). */
  const start = useCallback(async (): Promise<RecordingResult> => {
    if (recorderRef.current) throw new Error('A recording is already in progress.');

    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      const message = 'This browser cannot record audio. Please type your message instead.';
      setState((s) => ({ ...s, status: 'error', error: message }));
      throw new Error(message);
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      const message = 'Microphone access is not available in this browser.';
      setState((s) => ({ ...s, status: 'error', error: message }));
      throw new Error(message);
    }

    setState((s) => ({ ...s, status: 'requesting', error: null }));

    let stream: MediaStream;
    try {
      // These constraints are what make this usable on a phone speaker rather
      // than an unusable feedback loop.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      const message = denied
        ? 'Microphone permission was denied. Please allow it or type your message.'
        : 'Could not access the microphone. Please check your device settings.';
      setState((s) => ({ ...s, status: 'error', error: message }));
      throw new Error(message);
    }

    streamRef.current = stream;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      // Some engines reject the options form but still support the default
      // container, so fall back rather than failing outright.
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        teardown();
        const message = 'This browser could not start a recording.';
        setState((s) => ({ ...s, status: 'error', error: message }));
        throw new Error(message);
      }
    }
    recorderRef.current = recorder;
    // Read the type back off the recorder: the authoritative value.
    const activeMime = recorder.mimeType || mimeType;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: activeMime });
      const durationMs = Date.now() - startedAtRef.current;
      chunksRef.current = [];
      teardown();
      recorderRef.current = null;
      setState((s) => ({
        ...s,
        status: 'stopped',
        elapsedMs: durationMs,
        levels: IDLE_LEVELS,
        mimeType: activeMime,
      }));
      finishRef.current?.({ blob, extension: extensionForMime(activeMime), durationMs });
      finishRef.current = null;
    };

    recorder.onerror = () => {
      teardown();
      recorderRef.current = null;
      const message = 'The recording failed. Please try again.';
      setState((s) => ({ ...s, status: 'error', error: message }));
      finishRef.current = null;
    };

    // --- Live waveform from real analyser data -----------------------------
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        const context = new Ctor();
        audioContextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        // The microphone stream is the SOURCE of this analysis — not an
        // oscillator, not a synthetic pattern.
        context.createMediaStreamSource(stream).connect(analyser);
        analyserRef.current = analyser;

        const buffer = new Uint8Array(analyser.fftSize);
        const draw = () => {
          analyser.getByteTimeDomainData(buffer);
          const step = Math.max(1, Math.floor(buffer.length / BAR_COUNT));
          const levels: number[] = [];
          for (let bar = 0; bar < BAR_COUNT; bar += 1) {
            // RMS across this bar's slice, mapped into 0..1.
            let sumSquares = 0;
            let count = 0;
            const from = bar * step;
            const to = Math.min(from + step, buffer.length);
            for (let i = from; i < to; i += 1) {
              const sample = (buffer[i] - 128) / 128;
              sumSquares += sample * sample;
              count += 1;
            }
            const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
            // Scaled so ordinary speech fills a useful part of the bar height.
            levels.push(Math.min(1, rms * 3.2));
          }
          setState((s) => (s.status === 'recording' ? { ...s, levels } : s));
          rafRef.current = requestAnimationFrame(draw);
        };
        rafRef.current = requestAnimationFrame(draw);
      }
    } catch {
      // Visualisation is a nicety; recording continues fine without it.
      analyserRef.current = null;
    }

    startedAtRef.current = Date.now();
    // A timeslice keeps chunks flowing so a long recording does not sit in one
    // unbounded buffer, and `ondataavailable` can see progress.
    recorder.start(250);
    setState((s) => ({
      ...s,
      status: 'recording',
      elapsedMs: 0,
      levels: IDLE_LEVELS,
      error: null,
      mimeType: activeMime,
    }));
    timerRef.current = setInterval(() => {
      setState((s) =>
        s.status === 'recording' ? { ...s, elapsedMs: Date.now() - startedAtRef.current } : s,
      );
    }, 200);

    return new Promise<RecordingResult>((resolve) => {
      finishRef.current = resolve;
    });
  }, [teardown]);

  /** Stops the current recording; the `start()` promise then resolves. */
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        teardown();
        recorderRef.current = null;
        finishRef.current = null;
        setState((s) => ({ ...s, status: 'idle' }));
      }
    }
  }, [teardown]);

  /** Aborts and discards, producing no result and releasing the microphone. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    finishRef.current = null;
    chunksRef.current = [];
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    recorderRef.current = null;
    teardown();
    setState({ status: 'idle', elapsedMs: 0, levels: IDLE_LEVELS, error: null, mimeType: null });
  }, [teardown]);

  /** Returns to idle after a recording has been sent or discarded. */
  const reset = useCallback(() => {
    setState({ status: 'idle', elapsedMs: 0, levels: IDLE_LEVELS, error: null, mimeType: null });
  }, []);

  return { state, start, stop, cancel, reset };
}
