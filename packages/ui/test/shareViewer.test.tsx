import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { PresenceMessage, ServerMessage, ShareInfo } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { WsSource } from '../src/source/WsSource.js';
import { createSource } from '../src/source/createSource.js';
import { savedShareName } from '../src/share/path.js';
import { contentHash } from '../src/viewers/hash.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg width="100" height="50"></svg>' })),
  },
}));

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
  it('tells the relay which file it is on, and again when it moves', async () => {
    const s = await open();
    await waitFor(() => expect(s.sent).toContainEqual({ type: 'at', path: 'README.md' }));
    const files = screen.getByRole('navigation', { name: 'Files' });
    fireEvent.click(within(files).getByText('docs'));
    fireEvent.click(await within(files).findByText('plan.md'));
    await waitFor(() => expect(s.sent).toContainEqual({ type: 'at', path: 'docs/plan.md' }));
  });

  it('the_banner_names_the_host_and_shows_who_is_here', async () => {
    const s = await open();
    expect((await banner()).textContent).toContain('Rob’s share · brisk-otter-lantern');
    expect(within(await banner()).queryAllByRole('img')).toEqual([]);
    act(() => s.emit(presence()));
    await waitFor(async () => expect(within(await banner()).getAllByRole('img')).toHaveLength(2));
    const here = within(await banner());
    expect(here.getByRole('img', { name: 'Ada' })).toBeTruthy();
    expect(here.getByRole('img', { name: 'Linus' })).toBeTruthy();
    expect(here.queryByRole('img', { name: 'Grace' })).toBeNull(); // never yourself
    expect((await banner()).textContent).not.toContain('here');
  });

  it('shows who is on each file in the tree, and who is inside a closed folder', async () => {
    const s = await open();
    act(() =>
      s.emit(
        presence({
          hostPath: 'docs/plan.md',
          viewers: [
            { ...viewer('v1', 'Ada'), path: 'README.md' },
            { ...viewer('v2', 'Grace'), path: 'docs/guide.md' },
          ],
          you: 'v2',
        }),
      ),
    );
    const readme = await screen.findByRole('treeitem', { name: /README/ });
    await waitFor(() => expect(within(readme).getByRole('img', { name: 'Ada' })).toBeTruthy());
    expect(within(readme).getByRole('img', { name: 'Ada' }).textContent).toBe('A');
    expect(within(readme).queryByRole('img', { name: 'Grace' })).toBeNull(); // never yourself
    const docs = screen.getByRole('treeitem', { name: /^docs/ }); // collapsed
    expect(within(docs).getByRole('img', { name: 'Rob' })).toBeTruthy();
  });

  it('says where it is again when a reconnect brings a new welcome', async () => {
    const s = await open();
    await waitFor(() => expect(s.sent).toContainEqual({ type: 'at', path: 'README.md' }));
    act(() =>
      s.emit({
        type: 'welcome',
        protocol: 1,
        root: { kind: 'dir', name: 'x' },
        config: {},
        capabilities: { watch: true, write: false, collaborate: false },
        participant: { id: 'local', name: 'You' },
        share: SHARE,
      }),
    );
    await waitFor(() =>
      expect(s.sent.filter((m) => m.type === 'at' && m.path === 'README.md')).toHaveLength(2),
    );
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

  it('a_rejoin_welcome_clears_reconnecting', async () => {
    const s = await open();
    act(() => s.emit({ type: 'shareStatus', state: 'reconnecting' }));
    await waitFor(async () => expect((await banner()).textContent).toBe('Reconnecting to Rob…'));
    // The page reconnected after the host was back: the relay sends no shareStatus to a
    // viewer joining a live share, only the welcome.
    act(() =>
      s.emit({
        type: 'welcome',
        protocol: 1,
        root: { kind: 'dir', name: 'x' },
        config: {},
        capabilities: { watch: true, write: false, collaborate: false },
        participant: { id: 'local', name: 'You' },
        share: SHARE,
      }),
    );
    await waitFor(async () => expect((await banner()).textContent).toContain('Rob’s share'));
    expect(useDocuments.getState().shareStatus).toBe('live');
    expect(useDocuments.getState().shareReason).toBeNull();
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

  // The relay refuses the join before any welcome, so the page knows no share yet.
  const refused = (first: ServerMessage) =>
    createSource({
      handle(msg, emit) {
        if (msg.type === 'hello') emit(first);
      },
    });
  it.each<[string, ServerMessage, string, string]>([
    [
      'a share the relay does not know',
      { type: 'shareStatus', state: 'ended', reason: 'unknown' },
      'This share has ended or does not exist',
      ID,
    ],
    [
      'a full share',
      { type: 'error', code: 'bad_request', message: 'this share is full' },
      'This share is full',
      'Reload the page to try again.',
    ],
    [
      'a relay on another protocol',
      { type: 'error', code: 'bad_request', message: 'this share runs leaf protocol 2; reload' },
      'This page is out of date',
      'Reload the page to update it.',
    ],
  ])('%s says so in the document’s place', async (_, first, title, detail) => {
    render(<Reader source={refused(first)} base={BASE} />);
    const notice = (await screen.findByText(title)).closest('[role="status"]')!;
    expect(notice.textContent).toContain(detail);
    expect(document.querySelector('.leaf-loading')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Share' })).toBeNull();
  });

  it('a share that fills up or moves on while this page was reading says so too', async () => {
    const s = await open();
    act(() => s.emit({ type: 'error', code: 'bad_request', message: 'this share is full' }));
    expect(await screen.findByText('This share is full')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull();
  });

  it('an error that is not a refusal changes nothing', async () => {
    const s = await open();
    act(() => s.emit({ type: 'error', code: 'bad_request', message: 'unknown message' }));
    expect(screen.getByRole('heading', { name: 'Title', level: 1 })).toBeTruthy();
    expect(useDocuments.getState().shareStatus).toBe('live');
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

describe('the host’s avatar on the block it has open', () => {
  const MMD = 'graph LR\nA-->B';
  const HASH = contentHash(MMD);
  it('wears the host’s avatar on that block only while the host has it open large', async () => {
    history.replaceState(null, '', `${BASE}/doc.md`);
    const s = scripted(
      { 'doc.md': `# Doc\n\n\`\`\`mermaid\n${MMD}\n\`\`\`\n` },
      { share: SHARE, capabilities: { watch: true, write: false, collaborate: false } },
    );
    render(<Reader source={s.source} base={BASE} />);
    await screen.findByRole('heading', { name: 'Doc', level: 1 });
    const frame = () => document.querySelector('.leaf-frame') as HTMLElement;
    await waitFor(() => expect(frame()).toBeTruthy());
    expect(within(frame()).queryByRole('img', { name: 'Rob' })).toBeNull();
    act(() =>
      s.emit(presence({ stage: { docPath: 'doc.md', blockHash: HASH }, you: 'v1', viewers: [] })),
    );
    await waitFor(() => expect(within(frame()).getByRole('img', { name: 'Rob' })).toBeTruthy());
    expect(frame().querySelector('.leaf-block-tools .leaf-block-host')).toBeTruthy();
    act(() =>
      s.emit(
        presence({ stage: { docPath: 'doc.md', blockHash: 'other' }, you: 'v1', viewers: [] }),
      ),
    );
    await waitFor(() => expect(within(frame()).queryByRole('img', { name: 'Rob' })).toBeNull());
  });
});

describe('the host’s own tab', () => {
  it('loses the viewers’ avatars when the share ends and its last presence has nobody', async () => {
    history.replaceState(null, '', '/');
    const s = scripted({ 'README.md': README, 'docs/plan.md': '# Plan\n' });
    render(<Reader source={s.source} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    act(() =>
      s.emit(presence({ you: 'host', viewers: [{ ...viewer('v1', 'Ada'), path: 'README.md' }] })),
    );
    const readme = await screen.findByRole('treeitem', { name: /README/ });
    await waitFor(() => expect(within(readme).getByRole('img', { name: 'Ada' })).toBeTruthy());
    act(() => s.emit(presence({ you: 'host', viewers: [] })));
    await waitFor(() => expect(within(readme).queryByRole('img', { name: 'Ada' })).toBeNull());
    expect(screen.queryAllByRole('img', { name: 'Ada' })).toEqual([]);
  });
});
