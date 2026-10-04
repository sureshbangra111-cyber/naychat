import { useEffect, useRef } from 'react';

/**
 * Interval polling with strict lifecycle management.
 *
 * Why polling and not WebSocket/Socket.IO: a short poll is enough for a
 * support chat, needs no extra infrastructure (no Redis/pub-sub), and the
 * existing UI already relied on polling, so behaviour is unchanged.
 *
 * Guarantees:
 *  * the interval is cleared on unmount and whenever inputs change (no leaks)
 *  * a slow async callback can never overlap itself (no request pile-up)
 *  * polling pauses while the tab is hidden and resumes (with an immediate
 *    catch-up fetch) when it becomes visible again
 */
export function usePolling(
  callback: () => Promise<unknown> | void,
  intervalMs: number,
  enabled = true,
): void {
  const callbackRef = useRef(callback);
  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest closure without restarting the interval on every render.
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = (delay: number) => {
      if (cancelled) return;
      clearTimer();
      timerRef.current = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;

      // If the previous tick is still in flight, skip this one but KEEP the
      // chain alive by scheduling the next tick. Returning early without
      // rescheduling would silently stop polling for the rest of the session.
      if (runningRef.current) {
        schedule(intervalMs);
        return;
      }

      runningRef.current = true;
      try {
        await callbackRef.current();
      } catch (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[polling] tick failed', error);
        }
      } finally {
        runningRef.current = false;
      }
      schedule(intervalMs);
    };

    // First run after a short delay so initial loading states are visible.
    schedule(Math.min(intervalMs, 800));

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Catch up immediately, then resume the normal cadence.
        schedule(200);
      } else {
        // Pause while hidden; the next visibilitychange restarts the chain.
        clearTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}