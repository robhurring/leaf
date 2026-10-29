import { describe, it, expect } from 'vitest';
import type { BlameHunk } from '@leaf/protocol';
import { blameFits, blameLabel, freshness, hunkAt, hunksIn, splitPr } from '../src/blame.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const h = (
  start: number,
  lines: number,
  commit: string,
  ageDays: number,
  extra = {},
): BlameHunk => ({
  start,
  lines,
  commit,
  author: 'Rob',
  date: NOW - ageDays * DAY,
  summary: `s ${commit}`,
  ...extra,
});
const hunks = [h(1, 2, 'aaaaaaaa1', 300), h(3, 1, 'bbbbbbbb2', 2), h(4, 3, 'aaaaaaaa1', 300)];

describe('blame helpers', () => {
  it('finds the hunk holding a line', () => {
    expect(hunkAt(hunks, 1)?.commit).toBe('aaaaaaaa1');
    expect(hunkAt(hunks, 3)?.commit).toBe('bbbbbbbb2');
    expect(hunkAt(hunks, 6)?.start).toBe(4);
    expect(hunkAt(hunks, 7)).toBeUndefined();
  });

  it('lists the hunks touching a line range, in order', () => {
    expect(hunksIn(hunks, 2, 4).map((x) => x.start)).toEqual([1, 3, 4]);
    expect(hunksIn(hunks, 5, 9).map((x) => x.start)).toEqual([4]);
  });

  it('newer commits are fresher: 1 for the newest, down to a floor for the oldest', () => {
    const f = freshness(hunks);
    expect(f.get('bbbbbbbb2')).toBe(1);
    expect(f.get('aaaaaaaa1')).toBeLessThan(1);
    expect(f.get('aaaaaaaa1')).toBeGreaterThanOrEqual(0.2);
    // One commit only: fully fresh.
    expect(freshness([hunks[0]!]).get('aaaaaaaa1')).toBe(1);
  });

  it('labels a hunk briefly: commit, author, and age', () => {
    expect(blameLabel(hunks[1]!, NOW)).toBe('bbbbbbb Rob 2d');
    expect(blameLabel(hunks[0]!, NOW)).toBe('aaaaaaa Rob 10mo');
    expect(blameLabel(h(1, 1, 'ccccccc1', 800), NOW)).toBe('ccccccc Rob 2y');
    expect(blameLabel({ ...hunks[1]!, date: NOW - 5 * 3_600_000 }, NOW)).toBe('bbbbbbb Rob 5h');
    expect(blameLabel({ ...hunks[1]!, date: NOW - 20_000 }, NOW)).toBe('bbbbbbb Rob now');
    expect(blameLabel(h(9, 1, '0000000000', 0, { uncommitted: true, author: '' }), NOW)).toBe(
      'Not committed yet',
    );
  });

  it('the annotation column hides when the document area is too narrow to keep it and the text', () => {
    expect(blameFits(1000, 220)).toBe(true);
    expect(blameFits(700, 220)).toBe(false);
    expect(blameFits(800, 160)).toBe(true);
    // Not measured yet (zero width): assume it fits rather than flash hidden.
    expect(blameFits(0, 220)).toBe(true);
  });

  it('splits a trailing pull request number off a commit message', () => {
    expect(splitPr('docs: guide (#42)')).toEqual({ message: 'docs: guide', pr: '42' });
    expect(splitPr('no pr here')).toEqual({ message: 'no pr here' });
  });
});
