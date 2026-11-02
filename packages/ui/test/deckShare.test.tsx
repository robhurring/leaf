import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PresenceMessage, ShareInfo } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted } from './helpers/scripted.js';

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
const DECK = '---\nmarp: true\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n';
const w = window as unknown as Record<string, unknown>;

const presence = (slide?: { path: string; index: number }): PresenceMessage => ({
  type: 'presence',
  host: ROB,
  viewers: [{ id: 'v1', name: 'Ada', color: '#e5484d' }],
  you: 'v1',
  ...(slide ? { slide } : {}),
});

beforeEach(() => {
  useDocuments.getState().reset();
});
afterEach(() => {
  cleanup();
  delete w.__LEAF_TAB__;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI_EVENT_PLUGIN_INTERNALS__;
});

async function open(share?: ShareInfo) {
  history.replaceState(null, '', share ? `${BASE}/` : '/');
  const s = scripted(
    { 'deck.md': DECK, 'note.md': '# Note\n' },
    {
      ...(share ? { share } : {}),
      capabilities: { watch: true, write: false, collaborate: false },
    },
  );
  render(<Reader source={s.source} base={share ? BASE : ''} />);
  await screen.findByRole('status', { name: 'Slide' });
  await waitFor(() => expect(counter()).toBe('1 / 3'));
  return s;
}
const counter = () => screen.getByRole('status', { name: 'Slide' }).textContent;
const slides = (s: ReturnType<typeof scripted>) => s.sent.filter((m) => m.type === 'slide');

describe('a deck in a share', () => {
  it('a viewer follows the host’s slide, including on arrival', async () => {
    const s = await open(SHARE);
    act(() => s.emit(presence({ path: 'deck.md', index: 2 })));
    await waitFor(() => expect(counter()).toBe('3 / 3'));
  });

  it('a viewer who is told the slide before the deck is open lands on it', async () => {
    history.replaceState(null, '', `${BASE}/`);
    const s = scripted(
      { 'deck.md': DECK },
      { share: SHARE, capabilities: { watch: true, write: false, collaborate: false } },
    );
    render(<Reader source={s.source} base={BASE} />);
    await waitFor(() => expect(useDocuments.getState().share).not.toBeNull());
    act(() => s.emit(presence({ path: 'deck.md', index: 1 })));
    useDocuments.getState().open?.('deck.md');
    await waitFor(() => expect(counter()).toBe('2 / 3'));
  });

  it('a viewer who moves on their own stays until the host moves again', async () => {
    const s = await open(SHARE);
    act(() => s.emit(presence({ path: 'deck.md', index: 1 })));
    await waitFor(() => expect(counter()).toBe('2 / 3'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(counter()).toBe('3 / 3'));
    act(() => s.emit(presence({ path: 'deck.md', index: 1 })));
    expect(counter()).toBe('3 / 3');
    act(() => s.emit(presence({ path: 'deck.md', index: 0 })));
    await waitFor(() => expect(counter()).toBe('1 / 3'));
  });

  it('a slide for another deck is ignored', async () => {
    const s = await open(SHARE);
    act(() => s.emit(presence({ path: 'other.md', index: 2 })));
    expect(counter()).toBe('1 / 3');
  });

  it('a viewer never reports a slide', async () => {
    const s = await open(SHARE);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(counter()).toBe('2 / 3'));
    cleanup();
    expect(slides(s)).toEqual([]);
  });

  it('the host reports its slide, and leaving the deck', async () => {
    w.__LEAF_TAB__ = true;
    w.__TAURI_INTERNALS__ = { invoke: async () => 0, transformCallback: () => 0 };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    const s = await open();
    await waitFor(() =>
      expect(s.sent).toContainEqual({ type: 'slide', slide: { path: 'deck.md', index: 0 } }),
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(s.sent).toContainEqual({ type: 'slide', slide: { path: 'deck.md', index: 1 } }),
    );
    act(() => useDocuments.getState().open('note.md'));
    await screen.findByRole('heading', { name: 'Note', level: 1 });
    expect(slides(s).at(-1)).toEqual({ type: 'slide' });
  });
});
