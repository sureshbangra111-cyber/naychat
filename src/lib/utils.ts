/** Small shared helpers. Kept dependency-free on purpose. */

/** `2024-05-04T10:00:00Z` -> `10:00` in the viewer's locale. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Relative label for conversation rows: `Just now`, `12m`, `3h`, `2d`, date. */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (isSameDay(date, now)) return formatTime(iso);
  if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}d`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** `Today` / `Yesterday` / `12 Mar` — used for date separators in the chat. */
export function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Truncates for list previews without breaking the layout. */
export function truncate(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Joins conditional class names. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/** Short label for the anonymous visitor id, e.g. `a1b2c3d4`. */
export function shortVisitorId(visitorId: string | null | undefined): string {
  if (!visitorId) return 'Unknown';
  return visitorId.replace(/-/g, '').slice(0, 8);
}

export function initials(name: string | null | undefined, fallback: string): string {
  const source = (name ?? '').trim();
  if (source.length === 0) return fallback;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}