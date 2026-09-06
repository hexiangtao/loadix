/** Locale-aware relative time for history rows ("3 minutes ago"). */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** ~2 months in seconds — beyond this, a plain date reads better. */
const ABSOLUTE_THRESHOLD_S = 2 * 2_592_000;

/**
 * Format `ts` relative to `now` in the given locale (e.g. "now",
 * "5 minutes ago", "yesterday", "last week"). Falls back to a plain date
 * beyond ~2 months so old entries stay scannable.
 */
export function timeAgo(ts: number, locale: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds >= ABSOLUTE_THRESHOLD_S) {
    return new Date(ts).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return rtf.format(-seconds, 'second');
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit);
  }
  return rtf.format(-seconds, 'minute');
}