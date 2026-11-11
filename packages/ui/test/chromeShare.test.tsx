// The title row's Share button: the active tab's share, and the click the app answers
// with its own menu (a dropdown would be cut off by the title row's height).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Chrome } from '../src/chrome/Chrome.js';
import type { Bridge, Hover, TabInfo, TabShare, TabState } from '../src/chrome/bridge.js';

const tab = (id: string, active: boolean, shared = false): TabInfo => ({
  id,
  label: `~/${id}`,
  path: `~/${id}`,
  kind: 'folder',
  name: id,
  active,
  shared,
});
const IDLE: TabShare = { id: '', webUrl: '', appUrl: '', status: 'idle', viewers: [] };
const LIVE: TabShare = {
  id: 'abc',
  webUrl: 'https://relay.test/s/abc',
  appUrl: 'leaf://join/abc',
  status: 'live',
  viewers: [{ id: 'v1', name: 'Ada', color: '#e5484d' }],
};

function fakeBridge(tabs: TabInfo[], share: TabShare | null) {
  const subs = {
    tabs: [] as (() => void)[],
    share: [] as ((e: { tab: string; share: TabShare }) => void)[],
    copied: [] as (() => void)[],
  };
  const bridge: Bridge = {
    windowLabel: () => 'w1',
    tabs: vi.fn(async () => tabs),
    state: vi.fn(async (): Promise<TabState | null> => null),
    select: vi.fn(),
    close: vi.fn(),
    newTab: vi.fn(),
    command: vi.fn(),
    reorder: vi.fn(),
    dragMove: vi.fn(),
    dragEnd: vi.fn(),
    appearanceMenu: vi.fn(),
    activeShare: vi.fn(async () => share),
    shareButton: vi.fn(),
    onTabs: (fn) => (subs.tabs.push(fn), () => {}),
    onHover: (_fn: (h: Hover) => void) => () => {},
    onTabState: () => () => {},
    onShare: (fn) => (subs.share.push(fn), () => {}),
    onCopied: (fn) => (subs.copied.push(fn), () => {}),
  };
  return { bridge, subs };
}

async function mount(tabs: TabInfo[], share: TabShare | null) {
  const f = fakeBridge(tabs, share);
  render(<Chrome bridge={f.bridge} />);
  await act(async () => {});
  return f;
}
const bar = () => screen.getByRole('banner');

afterEach(() => vi.useRealTimers());

describe('the title row’s Share button', () => {
  it('is absent when this leaf has no relay to share through', async () => {
    await mount([tab('t1', true)], null);
    expect(within(bar()).queryByRole('button', { name: /share/i })).toBeNull();
  });

  it('offers to share the active tab when nothing is shared', async () => {
    await mount([tab('t1', true)], IDLE);
    expect(within(bar()).getByRole('button', { name: 'Share this tab' })).toBeTruthy();
  });

  it('shows Sharing and how many are watching while the tab is shared', async () => {
    await mount([tab('t1', true, true)], LIVE);
    const btn = within(bar()).getByRole('button', { name: 'Sharing' });
    expect(within(btn).getByRole('img', { name: 'Ada' })).toBeTruthy();
    expect(within(btn).queryByText('1')).toBeNull();
  });

  it('shows three avatars and how many more when a crowd is watching', async () => {
    const names = ['Ada', 'Bob', 'Cy', 'Di', 'Ed'];
    const crowd = { ...LIVE, viewers: names.map((n) => ({ id: n, name: n, color: '#e5484d' })) };
    await mount([tab('t1', true, true)], crowd);
    const btn = within(bar()).getByRole('button', { name: 'Sharing' });
    expect(within(btn).getAllByRole('img')).toHaveLength(3);
    expect(within(btn).getByText('+2').getAttribute('title')).toBe('Di, Ed');
  });

  it('hands the click to the app, which answers with its own menu', async () => {
    const { bridge } = await mount([tab('t1', true, true)], LIVE);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Sharing' }));
    expect(bridge.shareButton).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('follows the active tab’s share as the app reports it, and ignores other tabs’', async () => {
    const { subs } = await mount([tab('t1', true), tab('t2', false)], IDLE);
    act(() => subs.share.forEach((f) => f({ tab: 't2', share: LIVE })));
    expect(within(bar()).getByRole('button', { name: 'Share this tab' })).toBeTruthy();
    act(() => subs.share.forEach((f) => f({ tab: 't1', share: LIVE })));
    expect(within(bar()).getByRole('button', { name: 'Sharing' })).toBeTruthy();
    act(() =>
      subs.share.forEach((f) => f({ tab: 't1', share: { ...LIVE, status: 'reconnecting' } })),
    );
    const btn = within(bar()).getByRole('button', { name: 'Sharing' });
    expect(btn.getAttribute('title')).toBe('Reconnecting to the relay…');
    expect(btn.getAttribute('data-status')).toBe('reconnecting');
  });

  it('asks again for the active tab’s share when the tabs change', async () => {
    const { bridge, subs } = await mount([tab('t1', true)], IDLE);
    expect(bridge.activeShare).toHaveBeenCalledTimes(1);
    await act(async () => subs.tabs.forEach((f) => f()));
    expect(bridge.activeShare).toHaveBeenCalledTimes(2);
  });

  it('flashes a check on the button after a link is copied', async () => {
    vi.useFakeTimers();
    const { subs } = await mount([tab('t1', true, true)], LIVE);
    act(() => subs.copied.forEach((f) => f()));
    const btn = within(bar()).getByRole('button', { name: 'Sharing' });
    expect(btn.getAttribute('data-copied')).toBe('true');
    act(() => void vi.advanceTimersByTime(1600));
    expect(btn.getAttribute('data-copied')).toBeNull();
  });
});
