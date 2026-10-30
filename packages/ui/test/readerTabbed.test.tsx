import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { followOtherTabs, useUi } from '../src/store/ui.js';
import { runCommand } from '../src/commands.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const w = window as unknown as Record<string, unknown>;
beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
  useUi.setState({ treeOpen: true });
  w.__TAURI_INTERNALS__ = {};
  w.__LEAF_TAB__ = true;
  vi.mocked(invoke).mockClear();
});
afterEach(() => {
  delete w.__TAURI_INTERNALS__;
  delete w.__LEAF_TAB__;
});

const dir = () => scripted({ 'README.md': README, 'docs/guide.md': GUIDE });
const reported = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === 'leaf_tab_state')
    .map(([, args]) => (args as { state: Record<string, unknown> }).state);

describe('a reader inside a tab', () => {
  it('leaves the title row to the window: no top bar of its own', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('tells the window what the title row should show', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    await waitFor(() =>
      expect(reported().at(-1)).toMatchObject({ treeOpen: true, path: 'README.md' }),
    );
    act(() => void runCommand('toggleTree'));
    await waitFor(() => expect(reported().at(-1)).toMatchObject({ treeOpen: false }));
  });

  it('opens Go to over the top of the tab', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    act(() => void runCommand('openPalette'));
    expect(screen.getByRole('combobox')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('tabs keep their settings in step', () => {
  it('takes another tab’s saved settings when they change', async () => {
    const off = followOtherTabs();
    const saved = JSON.parse(localStorage.getItem('leaf.ui') ?? '{"state":{},"version":0}');
    saved.state = { ...saved.state, textPct: 130 };
    localStorage.setItem('leaf.ui', JSON.stringify(saved));
    window.dispatchEvent(new StorageEvent('storage', { key: 'leaf.ui' }));
    await waitFor(() => expect(useUi.getState().textPct).toBe(130));
    off();
    useUi.setState({ textPct: 100 });
  });
});
