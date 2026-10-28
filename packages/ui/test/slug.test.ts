import { describe, it, expect } from 'vitest';
import { githubSlug } from '../src/render/slug.js';

describe('githubSlug', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ["What's new? (v2)", 'whats-new-v2'],
    ['  spaced  ', 'spaced'],
    ['Ünïcode ok', 'ünïcode-ok'],
  ])('%s', (t, s) => expect(githubSlug(t, new Map())).toBe(s));

  it('dedupes', () => {
    const seen = new Map<string, number>();
    expect(githubSlug('Setup', seen)).toBe('setup');
    expect(githubSlug('Setup', seen)).toBe('setup-1');
    expect(githubSlug('Setup', seen)).toBe('setup-2');
  });
});
