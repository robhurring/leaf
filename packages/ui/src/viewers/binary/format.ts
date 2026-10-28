export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Past this, a date reads better than "5 months ago". */
const RELATIVE_LIMIT = 90 * DAY;

/** "3 hours ago" for recent times; a plain date once it is a few months old. */
export function formatWhen(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  if (diff >= RELATIVE_LIMIT)
    return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return rtf.format(-Math.round(diff / MINUTE), 'minute');
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), 'hour');
  if (diff < 7 * DAY) return rtf.format(-Math.floor(diff / DAY), 'day');
  if (diff < 30 * DAY) return rtf.format(-Math.round(diff / (7 * DAY)), 'week');
  return rtf.format(-Math.round(diff / (30 * DAY)), 'month');
}
