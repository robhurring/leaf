import { describe, it, expect } from 'vitest';
import type { PresenceMessage, Peer } from '@leaf/protocol';
import { initials, peersOn, peersUnder } from '../src/share/presence.js';

const HOST: Peer = { id: 'host', name: 'Rob', color: '#3e63dd' };
const v = (id: string, name: string, path?: string): Peer => ({
  id,
  name,
  color: '#e5484d',
  ...(path ? { path } : {}),
});
const presence = (over: Partial<PresenceMessage>): PresenceMessage => ({
  type: 'presence',
  host: HOST,
  viewers: [],
  you: 'host',
  ...over,
});

describe('presence', () => {
  it('initials take the first letters of the first two words', () => {
    expect(initials('Brisk Otter')).toBe('BO');
    expect(initials('Rob')).toBe('R');
    expect(initials('  ada  lovelace x')).toBe('AL');
    expect(initials('')).toBe('?');
  });

  it('peersOn lists who is on a file, host included, never you', () => {
    const p = presence({
      hostPath: 'a.md',
      viewers: [v('v1', 'Ada', 'a.md'), v('v2', 'Me', 'a.md'), v('v3', 'Bob', 'b.md')],
      you: 'v2',
    });
    expect(peersOn(p, 'a.md').map((x) => x.id)).toEqual(['host', 'v1']);
    expect(peersOn(null, 'a.md')).toEqual([]);
  });

  it('peersUnder gathers readers inside a folder', () => {
    const p = presence({
      viewers: [
        v('v1', 'Ada', 'docs/a.md'),
        v('v2', 'Bob', 'docs/x/b.md'),
        v('v3', 'Cy', 'other.md'),
      ],
      you: 'host',
    });
    expect(peersUnder(p, 'docs').map((x) => x.id)).toEqual(['v1', 'v2']);
  });
});
