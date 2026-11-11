import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shareBase, shareIdFromPath, wsUrl } from '../src/share/path.js';
import { createRouter } from '../src/router.js';

const at = (href: string) => new URL(href) as unknown as Location;

beforeEach(() => history.replaceState(null, '', '/'));

describe('the share path', () => {
  it('shareIdFromPath', () => {
    expect(shareIdFromPath('/s/brisk-otter-lantern')).toBe('brisk-otter-lantern');
    expect(shareIdFromPath('/s/brisk-otter-lantern/')).toBe('brisk-otter-lantern');
    expect(shareIdFromPath('/s/brisk-otter-lantern/docs/x.md')).toBe('brisk-otter-lantern');
    expect(shareIdFromPath('/docs/x.md')).toBeNull();
    expect(shareIdFromPath('/s/brisk-otter')).toBeNull();
    expect(shareIdFromPath('/s/brisk-otter-lanterns2/x')).toBeNull();
    expect(shareIdFromPath('/x/s/brisk-otter-lantern')).toBeNull();
  });

  it('wsUrl_and_router_follow_the_share_path', () => {
    expect(wsUrl(at('http://host/s/brisk-otter-lantern/docs/x.md'))).toBe(
      'ws://host/s/brisk-otter-lantern/ws',
    );
    expect(wsUrl(at('https://relay.test/s/brisk-otter-lantern'))).toBe(
      'wss://relay.test/s/brisk-otter-lantern/ws',
    );
    expect(shareBase('/s/brisk-otter-lantern/docs/x.md')).toBe('/s/brisk-otter-lantern');
    history.replaceState(null, '', '/s/brisk-otter-lantern/docs/x.md');
    expect(createRouter(shareBase(location.pathname)).current().path).toBe('docs/x.md');
  });

  it('outside a share, as before', () => {
    expect(wsUrl(at('http://host/docs/x.md'))).toBe('ws://host/ws');
    expect(shareBase('/docs/x.md')).toBe('');
  });

  describe('the ?ws= override', () => {
    afterEach(() => vi.unstubAllEnvs());

    it.each(['http://localhost:5173', 'http://127.0.0.1:4000', 'http://[::1]:4000'])(
      'is honoured on loopback (%s)',
      (origin) => {
        vi.stubEnv('DEV', false);
        expect(wsUrl(at(`${origin}/x?ws=ws://other/ws`))).toBe('ws://other/ws');
      },
    );

    it('is honoured in a dev build on any host', () => {
      vi.stubEnv('DEV', true);
      expect(wsUrl(at('http://devbox.lan:5173/x?ws=ws://other/ws'))).toBe('ws://other/ws');
    });

    it('is ignored anywhere else: a relay’s page reads only that relay', () => {
      vi.stubEnv('DEV', false);
      expect(wsUrl(at('https://relay.test/s/brisk-otter-lantern?ws=wss://elsewhere/ws'))).toBe(
        'wss://relay.test/s/brisk-otter-lantern/ws',
      );
      expect(wsUrl(at('http://host/x?ws=ws://other/ws'))).toBe('ws://host/ws');
      expect(wsUrl(at('http://localhost.evil.test/x?ws=ws://other/ws'))).toBe(
        'ws://localhost.evil.test/ws',
      );
    });
  });
});
