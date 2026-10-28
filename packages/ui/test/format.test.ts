import { describe, it, expect } from 'vitest';
import { formatWhen } from '../src/viewers/binary/format.js';

const now = new Date(2026, 9, 28, 12, 0, 0).getTime();
const ago = (ms: number) => formatWhen(now - ms, now);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatWhen', () => {
  it('is relative for recent times', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(5 * MIN)).toBe('5 minutes ago');
    expect(ago(3 * HOUR)).toBe('3 hours ago');
    expect(ago(DAY + HOUR)).toBe('yesterday');
    expect(ago(4 * DAY)).toBe('4 days ago');
    expect(ago(15 * DAY)).toBe('2 weeks ago');
    expect(ago(70 * DAY)).toBe('2 months ago');
  });

  it('becomes a date after about three months', () => {
    expect(ago(120 * DAY)).toBe(
      new Date(now - 120 * DAY).toLocaleDateString(undefined, { dateStyle: 'medium' }),
    );
  });
});
