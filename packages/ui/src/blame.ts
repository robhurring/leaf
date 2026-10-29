// Git blame for the views that show it: which hunk holds a line, how fresh each
// commit is (for shading), and the one-line label a hunk shows when expanded.
import type { BlameHunk } from '@leaf/protocol';
import { formatWhen } from './viewers/binary/format.js';

/** The hunk holding 1-based `line`. */
export function hunkAt(hunks: BlameHunk[], line: number): BlameHunk | undefined {
  let lo = 0;
  let hi = hunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const h = hunks[mid]!;
    if (line < h.start) hi = mid - 1;
    else if (line >= h.start + h.lines) lo = mid + 1;
    else return h;
  }
  return undefined;
}

/** The hunks touching lines `from`..`to`, in order. */
export function hunksIn(hunks: BlameHunk[], from: number, to: number): BlameHunk[] {
  return hunks.filter((h) => h.start <= to && h.start + h.lines - 1 >= from);
}

/** The palest a commit gets: old lines stay visible, just quieter. */
const FLOOR = 0.2;

/** Per commit, 1 for the newest down to FLOOR for the oldest, evenly by age rank. */
export function freshness(hunks: BlameHunk[]): Map<string, number> {
  const dates = new Map<string, number>();
  for (const h of hunks) dates.set(h.commit, h.uncommitted ? Infinity : h.date);
  const byAge = [...dates.entries()].sort((a, b) => a[1] - b[1]);
  const out = new Map<string, number>();
  const steps = byAge.length - 1;
  byAge.forEach(([commit], i) => out.set(commit, steps ? FLOOR + ((1 - FLOOR) * i) / steps : 1));
  return out;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, in the fewest characters: `now`, `5m`, `22h`, `3d`, `2w`, `5mo`, `2y`. */
export function shortAge(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < MINUTE) return 'now';
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 14 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 60 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  if (d < 365 * DAY) return `${Math.floor(d / (30 * DAY))}mo`;
  return `${Math.floor(d / (365 * DAY))}y`;
}

/** `abc1234 Rob 2d`: the commit, who made it, and how long ago, briefly. */
export function blameLabel(h: BlameHunk, now = Date.now()): string {
  if (h.uncommitted) return 'Not committed yet';
  return `${h.commit.slice(0, 7)} ${h.author} ${shortAge(h.date, now)}`;
}

/** The hover text: commit, author, the full relative date, and the summary. */
export function blameTitle(h: BlameHunk, now = Date.now()): string {
  if (h.uncommitted) return 'Changed here, not committed yet';
  return `${h.commit.slice(0, 7)} ${h.author}, ${formatWhen(h.date, now)}\n${h.summary}`;
}

/** The narrowest the text may get beside blame before the annotations step aside. */
const MIN_TEXT = 560;

/** Whether a blame column of `blameWidth` leaves room to read in an area `width` wide. */
export function blameFits(width: number, blameWidth: number): boolean {
  // Zero: not measured yet; assume it fits rather than flash hidden.
  return width === 0 || width - blameWidth >= MIN_TEXT;
}

/** `docs: guide (#42)` → the message and the pull request number GitHub appended. */
export function splitPr(summary: string): { message: string; pr?: string } {
  const m = /\s*\(#(\d+)\)\s*$/.exec(summary);
  return m ? { message: summary.slice(0, m.index), pr: m[1] } : { message: summary };
}
