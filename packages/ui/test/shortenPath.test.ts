import { describe, it, expect } from 'vitest';
import { shortenPath } from '../src/components/shortenPath.js';

const within = (n: number) => (s: string) => s.length <= n;

describe('shortenPath', () => {
  it('keeps a path that fits as it is', () => {
    expect(shortenPath('docs/guide.md', within(40))).toBe('docs/guide.md');
  });

  it('shortens folders to their first letter, outermost first, until it fits', () => {
    const p = 'alpha/beta/gamma/deep/filename.md';
    expect(shortenPath(p, within(30))).toBe('a/beta/gamma/deep/filename.md');
    expect(shortenPath(p, within(22))).toBe('a/b/g/deep/filename.md');
    expect(shortenPath(p, within(10))).toBe('a/b/g/d/filename.md');
  });

  it('keeps a leading dot with its letter, and never shortens the file name', () => {
    expect(shortenPath('.github/workflows/ci.yml', within(5))).toBe('.g/w/ci.yml');
  });
});
