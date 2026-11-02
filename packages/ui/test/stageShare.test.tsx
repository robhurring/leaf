import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClientMessage, PresenceMessage, ShareInfo } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { useAnnotations, type Stroke } from '../src/store/annotations.js';
import { useStage } from '../src/store/stage.js';
import { contentHash } from '../src/viewers/hash.js';
import { scripted } from './helpers/scripted.js';

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
const MMD = 'graph LR\nA-->B\n';
const HASH = contentHash(MMD);
const w = window as unknown as Record<string, unknown>;

const v = (id: string, name: string, path?: string) => ({
  id,
  name,
  color: '#e5484d',
  ...(path ? { path } : {}),
});
const presence = (over: Partial<PresenceMessage> = {}): PresenceMessage => ({
  type: 'presence',
  host: ROB,
  viewers: [],
  you: 'v2',
  ...over,
});
const at = (x: number, y: number) => ({ docPath: 'a.mmd', blockHash: HASH, x, y });
const hostStroke = (over: Partial<Stroke> = {}) => ({
  id: 'k1',
  docPath: 'a.mmd',
  blockHash: HASH,
  points: [
    [1, 1],
    [9, 9],
  ] as [number, number][],
  color: 'red' as const,
  width: 4,
  sticky: true,
  createdAt: 1,
  ...over,
});

beforeEach(() => {
  useDocuments.getState().reset();
  useAnnotations.setState({ strokes: [] });
  useStage.setState({ open: null, tool: 'hand', color: 'blue', brush: 'large', sticky: false });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  delete w.__LEAF_TAB__;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI_EVENT_PLUGIN_INTERNALS__;
});

async function openFile(name: string, share?: ShareInfo) {
  history.replaceState(null, '', share ? `${BASE}/${name}` : `/${name}`);
  const s = scripted(
    { [name]: MMD, 'note.md': '# Note\n' },
    {
      ...(share ? { share } : {}),
      capabilities: { watch: true, write: false, collaborate: false },
    },
  );
  render(<Reader source={s.source} base={share ? BASE : ''} />);
  act(() => useDocuments.getState().open(name));
  await screen.findByTestId('stage-viewport');
  return s;
}
const asHost = () => {
  w.__LEAF_TAB__ = true;
  w.__TAURI_INTERNALS__ = { invoke: async () => 0, transformCallback: () => 0 };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
};
const viewport = () => screen.getByTestId('stage-viewport');
function drawOne() {
  const t = viewport();
  fireEvent.pointerDown(t, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
  fireEvent.pointerMove(t, { clientX: 40, clientY: 30, pointerId: 1 });
  fireEvent.pointerMove(t, { clientX: 60, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(t, { pointerId: 1 });
}
const ofType = (s: { sent: ClientMessage[] }, ...types: string[]) =>
  s.sent.filter((m) => types.includes(m.type));
// The dots are on the canvas; the same names are on avatars elsewhere on the page.
const dots = () => within(screen.getByTestId('stage-layer'));
const inks = () => document.querySelectorAll('path.leaf-ink');

describe('pointers and ink on a shared canvas', () => {
  it('draws another peer’s pointer on the same canvas and not elsewhere', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit(presence({ viewers: [v('v1', 'Ada', 'a.mmd'), v('v2', 'Grace')] })));
    act(() => s.emit({ type: 'pointer', peer: 'v1', pointer: at(10, 20) }));
    const dot = dots().getByRole('img', { name: 'Ada' });
    expect(dot.querySelector('circle')!.getAttribute('r')).toBe('6');
    expect(dot.querySelector('circle')!.getAttribute('fill')).toBe('#e5484d');
    expect(dot.querySelector('text')!.textContent).toBe('Ada');
    act(() =>
      s.emit({
        type: 'pointer',
        peer: 'v1',
        pointer: { docPath: 'other.mmd', blockHash: 'x', x: 1, y: 1 },
      }),
    );
    expect(dots().queryByRole('img', { name: 'Ada' })).toBeNull();
  });

  it('keeps the dots and name tags the same size on screen at any zoom', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit(presence({ viewers: [v('v1', 'Ada', 'a.mmd'), v('v2', 'Grace')] })));
    act(() => s.emit({ type: 'pointer', peer: 'v1', pointer: at(10, 20) }));
    const gesture = (type: string, scale: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, { scale, clientX: 0, clientY: 0 });
      act(() => {
        viewport().dispatchEvent(ev);
      });
    };
    gesture('gesturestart', 1);
    gesture('gesturechange', 2);
    gesture('gestureend', 2);
    expect(screen.getByTestId('stage-layer').style.transform).toContain('scale(2)');
    const dot = dots().getByRole('img', { name: 'Ada' });
    expect(dot.querySelector('circle')!.getAttribute('r')).toBe('3');
    const tag = dot.querySelector('text')!;
    expect(tag.getAttribute('font-size')).toBe('6');
    expect(tag.getAttribute('x')).toBe('15');
  });

  it('never draws the page’s own pointer', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit(presence({ viewers: [v('v2', 'Grace', 'a.mmd')] })));
    act(() => s.emit({ type: 'pointer', peer: 'v2', pointer: at(10, 20) }));
    expect(dots().queryByRole('img', { name: 'Grace' })).toBeNull();
  });

  it('a pointer that stops moving fades after five seconds, and one whose peer left goes at once', async () => {
    const s = await openFile('a.mmd', SHARE);
    vi.useFakeTimers();
    act(() => s.emit(presence({ viewers: [v('v1', 'Ada'), v('v3', 'Linus'), v('v2', 'Grace')] })));
    act(() => s.emit({ type: 'pointer', peer: 'v1', pointer: at(10, 20) }));
    act(() => vi.advanceTimersByTime(4000));
    expect(dots().getByRole('img', { name: 'Ada' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(dots().queryByRole('img', { name: 'Ada' })).toBeNull();

    act(() => s.emit({ type: 'pointer', peer: 'v3', pointer: at(5, 5) }));
    expect(dots().getByRole('img', { name: 'Linus' })).toBeTruthy();
    act(() => s.emit(presence({ viewers: [v('v2', 'Grace')] })));
    expect(dots().queryByRole('img', { name: 'Linus' })).toBeNull();
  });

  it('shows the host’s ink and lets the host clear it, leaving the viewer’s own strokes', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit({ type: 'ink', stroke: hostStroke({ id: 'k1' }) }));
    act(() => s.emit({ type: 'ink', stroke: hostStroke({ id: 'k2' }) }));
    expect(inks()).toHaveLength(2);
    act(() => useStage.setState({ tool: 'pencil' }));
    drawOne();
    expect(inks()).toHaveLength(3);
    act(() => s.emit({ type: 'inkUndo', docPath: 'a.mmd', blockHash: HASH }));
    expect(inks()).toHaveLength(2);
    act(() => s.emit({ type: 'inkClear', docPath: 'a.mmd', blockHash: HASH }));
    expect(inks()).toHaveLength(1);
    expect(useAnnotations.getState().strokes[0]!.peer).toBeUndefined();
  });

  it('a viewer back on a document keeps only the host ink the relay sends again', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit({ type: 'ink', stroke: hostStroke({ id: 'k1' }) }));
    expect(inks()).toHaveLength(1);
    // Away on another file, the host clears a.mmd; the viewer, not on it, never hears.
    act(() => useDocuments.getState().open('note.md'));
    act(() => useDocuments.getState().open('a.mmd'));
    const remote = () => useAnnotations.getState().strokes.filter((k) => k.peer);
    expect(remote()).toEqual([]);
    await waitFor(() => expect(ofType(s, 'at').at(-1)).toEqual({ type: 'at', path: 'a.mmd' }));
    act(() => s.emit({ type: 'ink', stroke: hostStroke({ id: 'k1' }) }));
    expect(remote().map((k) => k.id)).toEqual(['k1']);
  });

  it('a viewer sends its pointer, throttled, and gone on leave', async () => {
    const s = await openFile('a.mmd', SHARE);
    for (let i = 0; i < 10; i++)
      fireEvent.pointerMove(viewport(), { clientX: 10 + i, clientY: 20, pointerId: 1 });
    const moves = ofType(s, 'pointer');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      type: 'pointer',
      pointer: { docPath: 'a.mmd', blockHash: HASH },
    });
    fireEvent.pointerLeave(viewport(), { pointerId: 1 });
    expect(ofType(s, 'pointer').at(-1)).toEqual({ type: 'pointer' });
  });

  it('the host says which canvas it has open and sends each finished stroke', async () => {
    asHost();
    const s = await openFile('a.mmd');
    await waitFor(() =>
      expect(s.sent).toContainEqual({
        type: 'stage',
        stage: { docPath: 'a.mmd', blockHash: HASH },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pencil' }));
    drawOne();
    const mine = useAnnotations.getState().strokes[0]!;
    expect(ofType(s, 'ink')).toEqual([{ type: 'ink', stroke: mine }]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(s.sent.at(-1)).toEqual({ type: 'inkUndo', docPath: 'a.mmd', blockHash: HASH });
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawings' }));
    expect(s.sent.at(-1)).toEqual({ type: 'inkClear', docPath: 'a.mmd', blockHash: HASH });
    act(() => useDocuments.getState().open('note.md'));
    await screen.findByRole('heading', { name: 'Note', level: 1 });
    expect(ofType(s, 'stage').at(-1)).toEqual({ type: 'stage' });
    expect(ofType(s, 'pointer').at(-1)).toEqual({ type: 'pointer' });
  });

  it('a whole-file deck is not a canvas, so the host announces no stage for it', async () => {
    asHost();
    history.replaceState(null, '', '/deck.md');
    const s = scripted(
      { 'deck.md': '---\nmarp: true\n---\n\n# One\n\n---\n\n# Two\n' },
      { capabilities: { watch: true, write: false, collaborate: false } },
    );
    render(<Reader source={s.source} base="" />);
    act(() => useDocuments.getState().open('deck.md'));
    await screen.findByRole('status', { name: 'Slide' });
    expect(ofType(s, 'stage')).toEqual([]);
  });

  it('a viewer never sends stage or ink', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => useStage.setState({ tool: 'pencil' }));
    drawOne();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawings' }));
    cleanup();
    expect(ofType(s, 'stage', 'ink', 'inkUndo', 'inkClear')).toEqual([]);
  });

  it('a page outside a share sends nothing', async () => {
    const s = await openFile('a.mmd');
    fireEvent.pointerMove(viewport(), { clientX: 10, clientY: 20, pointerId: 1 });
    act(() => useStage.setState({ tool: 'pencil' }));
    drawOne();
    cleanup();
    expect(ofType(s, 'stage', 'pointer', 'ink', 'inkUndo', 'inkClear')).toEqual([]);
  });
});
