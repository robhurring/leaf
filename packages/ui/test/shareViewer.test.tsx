import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PresenceMessage, ShareInfo } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { WsSource } from '../src/source/WsSource.js';
import { savedShareName } from '../src/share/path.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';

const ID = 'brisk-otter-lantern';
const BASE = `/s/${ID}`;
const ROB = { id: 'h', name: 'Rob', color: '#3e63dd' };
const SHARE: ShareInfo = {
  id: ID,
  host: ROB,
  mode: 'read-only',
  webUrl: `https://relay.test/s/${ID}`,
  appUrl: `leaf://join/${ID}`,
};
const viewer = (id: string, name: string) => ({ id, name, color: '#e5484d' });
const presence = (over: Partial<PresenceMessage> = {}): PresenceMessage => ({
  type: 'presence',
  host: ROB,
  viewers: [viewer('v1', 'Ada'), viewer('v2', 'Grace'), viewer('v3', 'Linus')],
  you: 'v2',
  ...over,
});

beforeEach(() => {
  history.replaceState(null, '', `${BASE}/`);
  useDocuments.getState().reset();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

async function open() {
  const s = scripted(
    { 'README.md': README, 'docs/plan.md': '# Plan\n\nSteps.\n', 'docs/guide.md': GUIDE },
    { share: SHARE, capabilities: { watch: true, write: false, collaborate: false } },
  );
  render(<Reader source={s.source} base={BASE} />);
  await screen.findByRole('heading', { name: 'Title', level: 1 });
  return s;
}
const banner = () => screen.findByRole('region', { name: 'Share' });

describe('viewing a share', () => {
  it('the_banner_names_the_host_and_counts_viewers', async () => {
    const s = await open();
    expect((await banner()).textContent).toContain('Rob’s share · brisk-otter-lantern');
    expect((await banner()).textContent).not.toContain('here');
    act(() => s.emit(presence()));
    await waitFor(async () =>
      expect((await banner()).textContent).toContain('Rob’s share · brisk-otter-lantern · 3 here'),
    );
    act(() => s.emit(presence({ viewers: [viewer('v2', 'Grace')] })));
    await waitFor(async () => expect((await banner()).textContent).toMatch(/· 1 here$/));
  });

  it('the_host_s_file_is_one_click_away', async () => {
    const s = await open();
    act(() => s.emit(presence({ hostPath: 'docs/plan.md' })));
    fireEvent.click(await screen.findByRole('link', { name: 'Rob is reading docs/plan.md' }));
    await screen.findByRole('heading', { name: 'Plan', level: 1 });
    expect(location.pathname).toBe(`${BASE}/docs/plan.md`);
    expect(useDocuments.getState().path).toBe('docs/plan.md');
    // Once there, the link has nothing left to offer.
    await waitFor(() => expect(screen.queryByRole('link', { name: /is reading/ })).toBeNull());
  });

  it('reconnecting_says_so', async () => {
    const s = await open();
    act(() => s.emit({ type: 'shareStatus', state: 'reconnecting' }));
    await waitFor(async () => expect((await banner()).textContent).toBe('Reconnecting to Rob…'));
    act(() => s.emit({ type: 'shareStatus', state: 'live' }));
    await waitFor(async () => expect((await banner()).textContent).toContain('Rob’s share'));
  });

  it('ended_replaces_the_document', async () => {
    const s = await open();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('combobox')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    act(() => s.emit({ type: 'shareStatus', state: 'ended', reason: 'host' }));
    const notice = (await screen.findByText('Rob ended the share')).closest('[role="status"]')!;
    expect(notice.textContent).toContain(ID);
    expect(document.querySelector('main article')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull();
    // The tree slides away; the palette no longer opens.
    await waitFor(() => expect(document.querySelector('.leaf-tree')).toBeNull());
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it.each([
    ['host-gone', 'Rob’s leaf went away'],
    ['forbidden-path', 'You were disconnected from this share'],
  ])('ended_for_%s', async (reason, text) => {
    const s = await open();
    act(() => s.emit({ type: 'shareStatus', state: 'ended', reason }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('no_share_no_banner', async () => {
    history.replaceState(null, '', '/');
    const s = scripted({ 'README.md': README });
    render(<Reader source={s.source} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    expect(screen.queryByRole('region', { name: 'Share' })).toBeNull();
  });

  it('the_assigned_name_is_kept', async () => {
    const s = await open();
    act(() => s.emit(presence()));
    expect(localStorage.getItem('leaf.share.name')).toBe('Grace');
    // A name already chosen is not replaced.
    act(() => s.emit(presence({ viewers: [viewer('v2', 'Other')] })));
    expect(localStorage.getItem('leaf.share.name')).toBe('Grace');

    // The next page's source says who it is.
    expect(savedShareName()).toBe('Grace');
    const sockets: { url: string; sent: string[] }[] = [];
    class FakeWebSocket extends EventTarget {
      readyState = 0;
      sent: string[] = [];
      constructor(public url: string) {
        super();
        sockets.push(this);
      }
      send(d: string) {
        this.sent.push(d);
      }
      close() {}
    }
    const fetchImpl = vi.fn(async (_url: string) => new Response('ok'));
    const src = new WsSource(`ws://relay.test${BASE}/ws`, {
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      heartbeatMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      name: savedShareName(),
    });
    const sock = sockets[0] as unknown as FakeWebSocket;
    sock.readyState = 1;
    sock.dispatchEvent(new Event('open'));
    expect(JSON.parse(sock.sent[0]!)).toMatchObject({ type: 'hello', name: 'Grace' });
    // Its health probe sits beside the share's socket.
    src.check();
    expect(fetchImpl.mock.calls[0]![0]).toBe(`http://relay.test${BASE}/healthz`);
    src.close();
  });
});
