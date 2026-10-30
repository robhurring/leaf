import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Chrome } from '../src/chrome/Chrome.js';
import type { Bridge, Hover, TabInfo, TabState } from '../src/chrome/bridge.js';

const tab = (
  id: string,
  path: string,
  active = false,
  kind: 'folder' | 'file' = 'folder',
): TabInfo => ({
  id,
  label: path,
  path,
  kind,
  name: path.split('/').pop()!,
  active,
});

function fakeBridge(tabs: TabInfo[]) {
  const subs = {
    tabs: [] as (() => void)[],
    hover: [] as ((h: Hover) => void)[],
    state: [] as ((s: TabState) => void)[],
  };
  const bridge: Bridge = {
    windowLabel: () => 'w1',
    tabs: vi.fn(async () => tabs),
    select: vi.fn(),
    close: vi.fn(),
    newTab: vi.fn(),
    command: vi.fn(),
    reorder: vi.fn(),
    dragMove: vi.fn(),
    dragEnd: vi.fn(),
    onTabs: (fn) => (subs.tabs.push(fn), () => {}),
    onHover: (fn) => (subs.hover.push(fn), () => {}),
    onTabState: (fn) => (subs.state.push(fn), () => {}),
  };
  return { bridge, subs };
}

async function mount(tabs: TabInfo[], fits?: (s: string) => boolean) {
  const f = fakeBridge(tabs);
  render(<Chrome bridge={f.bridge} fits={fits} />);
  await act(async () => {});
  return f;
}

describe('the window chrome', () => {
  it('hides the tab row for one tab, and shows it for two', async () => {
    await mount([tab('t1', '~/a')]);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows two tabs, the active one selected', async () => {
    await mount([tab('t1', '~/a'), tab('t2', '~/b', true)]);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
  });

  it('opens the tab row while a dragged tab is over this window', async () => {
    const { subs } = await mount([tab('t1', '~/a')]);
    act(() => subs.hover.forEach((f) => f({ window: 'w1', index: 1 })));
    expect(screen.getByRole('tablist')).toBeTruthy();
    act(() => subs.hover.forEach((f) => f({ window: 'w2', index: 0 })));
    expect(screen.queryByRole('tablist')).toBeNull();
    act(() => subs.hover.forEach((f) => f(null)));
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shortens tab labels to fit, with the full path on hover', async () => {
    await mount(
      [tab('t1', '~/code/workspace/docs', true), tab('t2', '~/b')],
      (s) => s.length <= 10,
    );
    const first = within(screen.getByRole('tablist')).getAllByRole('tab')[0]!;
    expect(first.textContent).toContain('~/c/w/docs');
    expect(first.getAttribute('title')).toBe('~/code/workspace/docs');
  });

  it('gives each tab the icon of its kind', async () => {
    await mount([tab('t1', '~/a', true), tab('t2', '~/n/plan.md', false, 'file')]);
    const [folder, file] = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(folder!.querySelector('svg')).toBeTruthy();
    expect(folder!.querySelector('svg')!.outerHTML).not.toBe(file!.querySelector('svg')!.outerHTML);
  });

  it('sends the title row’s buttons to the active tab', async () => {
    const { bridge, subs } = await mount([tab('t1', '~/a', true)]);
    act(() =>
      subs.state.forEach((f) =>
        f({
          title: 'a.md',
          path: 'a.md',
          canBack: true,
          canForward: false,
          treeAvailable: true,
          treeOpen: true,
          outlineAvailable: true,
          outlineOpen: true,
          numbering: false,
          textPct: 100,
          theme: 'github',
          appearance: 'light',
          status: 'open',
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back (⌘[)' }));
    expect(bridge.command).toHaveBeenCalledWith('goBack');
    fireEvent.click(screen.getByRole('button', { name: 'Go to' }));
    expect(bridge.command).toHaveBeenCalledWith('openPalette');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle files' }));
    expect(bridge.command).toHaveBeenCalledWith('toggleTree');
  });

  it('closes a tab with its ×, and opens one with +', async () => {
    const { bridge } = await mount([tab('t1', '~/a', true), tab('t2', '~/b')]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[1]!);
    expect(bridge.close).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(bridge.newTab).toHaveBeenCalled();
  });
});
