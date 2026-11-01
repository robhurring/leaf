import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { useShare } from '../src/share/store.js';
import { scripted, README } from './helpers/scripted.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const w = window as unknown as Record<string, unknown>;
const IDLE = { id: '', webUrl: '', appUrl: '', status: 'idle', viewers: [] };
const LIVE = {
  id: 'abc',
  webUrl: 'https://relay.test/s/abc',
  appUrl: 'leaf://join/abc',
  status: 'live',
  viewers: [{ id: 'v1', name: 'Ada', color: '#e5484d' }],
};
let current: Record<string, unknown>;
let pushShare: (s: unknown) => void;
const writeText = vi.fn(async (_: string) => undefined);

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
  useShare.setState({ state: null, busy: false, error: null });
  w.__TAURI_INTERNALS__ = {};
  w.__LEAF_TAB__ = true;
  current = IDLE;
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((async (cmd: string) => {
    if (cmd === 'leaf_share_state') return current;
    if (cmd === 'leaf_share_start' || cmd === 'leaf_share_resume') return (current = LIVE);
    if (cmd === 'leaf_share_end') return void (current = IDLE);
    return undefined;
  }) as never);
  vi.mocked(listen).mockImplementation((async (
    name: string,
    fn: (e: { payload: unknown }) => void,
  ) => {
    if (name.startsWith('leaf://share/')) pushShare = (p) => fn({ payload: p });
    return () => {};
  }) as never);
});
afterEach(() => {
  delete w.__TAURI_INTERNALS__;
  delete w.__LEAF_TAB__;
});

const open = (relayUrl?: string) => {
  const s = scripted({ 'README.md': README }, { config: relayUrl ? { relayUrl } : {} });
  render(<Reader source={s.source} />);
  return screen.findByRole('heading', { name: 'Title', level: 1 });
};
const called = (cmd: string) => vi.mocked(invoke).mock.calls.some(([c]) => c === cmd);

describe('the Share menu', () => {
  it('no_relay_no_share_button', async () => {
    await open();
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
  });

  it('start_then_menu_items', async () => {
    await open('wss://relay.test');
    fireEvent.click(await screen.findByRole('button', { name: 'Share this tab' }));
    const btn = await screen.findByRole('button', { name: 'Sharing' });
    expect(called('leaf_share_start')).toBe(true);
    expect(within(btn).getByText('1')).toBeTruthy();
    fireEvent.click(btn);
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Copy app link', 'Copy web link', 'End session']);
    const watching = within(menu).getByRole('group', { name: 'Watching' });
    expect(within(watching).getByText('Ada')).toBeTruthy();
  });

  it('copy_web_link_writes_the_url', async () => {
    current = LIVE;
    await open('wss://relay.test');
    fireEvent.click(await screen.findByRole('button', { name: 'Sharing' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy web link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LIVE.webUrl));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy app link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LIVE.appUrl));
  });

  it('end_session_calls_the_app', async () => {
    current = LIVE;
    await open('wss://relay.test');
    fireEvent.click(await screen.findByRole('button', { name: 'Sharing' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End session' }));
    await screen.findByRole('button', { name: 'Share this tab' });
    expect(called('leaf_share_end')).toBe(true);
  });

  it('a_resumable_share_is_offered', async () => {
    current = { ...IDLE, resumable: 'abc' };
    await open('wss://relay.test');
    fireEvent.click(await screen.findByRole('button', { name: 'Share this tab' }));
    expect(called('leaf_share_start')).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume sharing' }));
    await screen.findByRole('button', { name: 'Sharing' });
    expect(called('leaf_share_resume')).toBe(true);
  });

  it('shows reconnecting, viewer events, and the ended notice', async () => {
    current = LIVE;
    await open('wss://relay.test');
    await screen.findByRole('button', { name: 'Sharing' });
    act(() => pushShare({ ...LIVE, status: 'reconnecting', viewers: [] }));
    const btn = screen.getByRole('button', { name: 'Sharing' });
    expect(btn.getAttribute('title')).toBe('Reconnecting to the relay…');
    expect(btn.getAttribute('data-status')).toBe('reconnecting');
    expect(within(btn).queryByText('0')).toBeNull();
    act(() => pushShare({ ...IDLE, status: 'ended' }));
    expect(screen.getByRole('status').textContent).toBe('Sharing ended');
    expect(screen.getByRole('button', { name: 'Share this tab' })).toBeTruthy();
  });

  it('shows a start error as an alert and in the title', async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === 'leaf_share_state') return IDLE;
      if (cmd === 'leaf_share_start') throw 'relay said no';
      return undefined;
    }) as never);
    await open('wss://relay.test');
    fireEvent.click(await screen.findByRole('button', { name: 'Share this tab' }));
    expect((await screen.findByRole('alert')).textContent).toBe('relay said no');
    expect(screen.getByRole('button', { name: 'Share this tab' }).getAttribute('title')).toBe(
      'relay said no',
    );
  });
});
