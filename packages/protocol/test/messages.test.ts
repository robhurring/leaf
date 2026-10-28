import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  isKnownClientType,
  FILE_KINDS,
} from '../src/index.js';

describe('protocol', () => {
  it('version is 1', () => expect(PROTOCOL_VERSION).toBe(1));

  it('parses hello', () =>
    expect(parseClientMessage({ type: 'hello', protocol: 1 })).toEqual({
      type: 'hello',
      protocol: 1,
    }));

  it('rejects hello with wrong version', () =>
    expect(() => parseClientMessage({ type: 'hello', protocol: 2 })).toThrow());

  it('parses read with id', () =>
    expect(parseClientMessage({ type: 'read', path: 'docs/a.md', id: 'r1' })).toMatchObject({
      path: 'docs/a.md',
      id: 'r1',
    }));

  it('rejects read without path', () =>
    expect(() => parseClientMessage({ type: 'read' })).toThrow());

  it('rejects unknown client type', () => {
    expect(isKnownClientType('nope')).toBe(false);
    expect(() => parseClientMessage({ type: 'nope' })).toThrow();
  });

  it('parses a file message with encoding none and no content', () => {
    const m = parseServerMessage({
      type: 'file',
      path: 'a.bin',
      kind: 'binary',
      mime: 'application/octet-stream',
      encoding: 'none',
      url: '/raw/a.bin',
      size: 10,
      mtime: 1,
    });
    expect(m).toMatchObject({ type: 'file', encoding: 'none' });
    expect(m.type === 'file' ? m.content : 'not a file').toBeUndefined();
  });

  it('parses welcome', () =>
    expect(
      parseServerMessage({
        type: 'welcome',
        protocol: 1,
        root: { kind: 'dir', name: 'examples' },
        config: {},
        capabilities: { watch: true, write: false, collaborate: false },
        participant: { id: 'local', name: 'You' },
      }).type,
    ).toBe('welcome'));

  it('parses changed with from on rename', () =>
    expect(
      parseServerMessage({ type: 'changed', path: 'b.md', change: 'renamed', from: 'a.md' }),
    ).toMatchObject({ from: 'a.md' }));

  it('rejects error with unknown code', () =>
    expect(() => parseServerMessage({ type: 'error', code: 'weird', message: 'x' })).toThrow());

  it('welcome config accepts maxEntries', () =>
    expect(
      parseServerMessage({
        type: 'welcome',
        protocol: 1,
        root: { kind: 'dir', name: 'x' },
        config: { maxEntries: 5000 },
        capabilities: { watch: true, write: false, collaborate: false },
        participant: { id: 'local', name: 'You' },
      }),
    ).toMatchObject({ config: { maxEntries: 5000 } }));

  it('file message may carry git info', () =>
    expect(
      parseServerMessage({
        type: 'file',
        path: 'a.md',
        kind: 'markdown',
        mime: 'text/markdown',
        encoding: 'utf8',
        content: '#',
        url: '/raw/a.md',
        size: 1,
        mtime: 1,
        git: {
          commit: 'abc1234',
          author: 'Rob',
          date: 1700000000000,
          message: 'docs: hi (#12)',
          repoUrl: 'https://github.com/rob/leaf',
        },
      }),
    ).toMatchObject({ git: { commit: 'abc1234' } }));

  it('exposes file kinds', () => expect(FILE_KINDS).toContain('markdown'));

  it('preferences travel in welcome and as a client message', () => {
    const prefs = { theme: 'paper', appearance: 'light', numbering: true, textPct: 110 };
    expect(parseClientMessage({ type: 'preferences', preferences: prefs })).toEqual({
      type: 'preferences',
      preferences: prefs,
    });
    expect(() =>
      parseClientMessage({ type: 'preferences', preferences: { theme: 'neon' } }),
    ).toThrow();
    const welcome = parseServerMessage({
      type: 'welcome',
      protocol: 1,
      root: { kind: 'dir', name: 'x' },
      config: {},
      capabilities: { watch: true, write: false, collaborate: false },
      participant: { id: 'local', name: 'You' },
      preferences: { outlineOpen: false },
    });
    expect(welcome).toMatchObject({ preferences: { outlineOpen: false } });
  });

  it('binary files can travel inline as base64, and a server can say it serves raw URLs', () => {
    const file = parseServerMessage({
      type: 'file',
      path: 'a.png',
      kind: 'image',
      mime: 'image/png',
      encoding: 'base64',
      content: 'iVBORw0KGgo=',
      url: '/raw/a.png',
      size: 8,
      mtime: 1,
    });
    expect(file).toMatchObject({ encoding: 'base64' });
    const welcome = parseServerMessage({
      type: 'welcome',
      protocol: 1,
      root: { kind: 'dir', name: 'x' },
      config: {},
      capabilities: { watch: true, write: false, collaborate: false, rawUrls: true },
      participant: { id: 'local', name: 'You' },
    });
    expect(welcome).toMatchObject({ capabilities: { rawUrls: true } });
  });
});
