import { useCallback, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface Props {
  src: string;
  /** Alt text. Defaults to a neutral label; a real caption is preferred. */
  alt: string;
  filename?: string | null;
  onClose: () => void;
}

/**
 * Full-screen image viewer.
 *
 * The image is contained with `object-contain` inside a flex box, so it is never
 * stretched or cropped and always fits 320px-wide phones as well as desktop.
 *
 * ACCESSIBILITY / a11y:
 *   * rendered as a labelled dialog with `role="dialog"` + `aria-modal`,
 *   * focus moves into the viewer on open and is trapped while it is open,
 *   * Escape and backdrop click both close it,
 *   * focus returns to the element that opened it.
 */
export function ImageViewer({ src, alt, filename, onClose }: Props) {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    // Return focus to the thumbnail that opened the viewer.
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [previouslyFocused]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      // Simple focus trap: Tab cycles between the two controls.
      if (event.key === 'Tab') {
        const focusable = document.querySelectorAll<HTMLElement>(
          '[data-image-viewer] button, [data-image-viewer] a',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // Lock the page behind the overlay so the chat cannot scroll underneath.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the viewer for keyboard and screen-reader users.
    const closeButton = document.querySelector<HTMLElement>('[data-image-viewer] button');
    closeButton?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close]);

  return (
    <div
      data-image-viewer
      role="dialog"
      aria-modal="true"
      aria-label={filename ? `Image: ${filename}` : 'Image preview'}
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      onClick={close}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/92 backdrop-blur-sm"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <p className="min-w-0 flex-1 truncate text-xs text-white/70">{filename ?? alt}</p>
        <div className="flex items-center gap-1">
          <a
            href={src}
            download={filename ?? 'image'}
            aria-label="Download image"
            onClick={(event) => event.stopPropagation()}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Download className="h-5 w-5" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={close}
            aria-label="Close image preview"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        <img
          src={src}
          alt={alt}
          // `object-contain` + max constraints = never distorted, never cropped.
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </div>
  );
}

interface TriggerProps {
  src: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  className?: string;
  onOpen: () => void;
}

/**
 * The in-bubble thumbnail that opens the viewer.
 *
 * A real `<button>` so it is reachable by keyboard and announced properly. The
 * intrinsic width/height are set from the stored metadata so the browser reserves
 * the right box BEFORE the bytes arrive — this is what stops the message list from
 * jumping as images load.
 */
export function ImageThumbnail({ src, alt, width, height, className, onOpen }: TriggerProps) {
  // Cap the rendered width but keep the aspect ratio from the real dimensions, so
  // a 4000x3000 photo does not dominate the conversation.
  const ratio = width && height && width > 0 ? width / height : 4 / 3;
  const heightStyle = width && height ? undefined : { aspectRatio: String(ratio) };

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View image: ${alt}`}
      className={cn(
        'group relative block overflow-hidden rounded-xl bg-slate-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        width={width ?? undefined}
        height={height ?? undefined}
        // Bounded to a bubble-sized box; the full-resolution original is only
        // fetched when the viewer is opened.
        loading="lazy"
        decoding="async"
        style={heightStyle}
        className="block max-h-80 w-full max-w-full object-cover"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-slate-900/0 transition-colors group-hover:bg-slate-900/10"
      />
    </button>
  );
}
