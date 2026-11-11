import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClientMessage, PresenceMessage, ShareInfo } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { INK_DRAFT_STALE_MS, useAnnotations, type Stroke } from '../src/store/annotations.js';
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
  useAnnotations.setState({ strokes: [], drafts: {} });
  useStage.setState({ open: null, tool: 'hand', color: 'blue', brush: 'large', sticky: false });
});
afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  // A deck's listen may still be answering; let it settle while the app's stubs are here,
  // or its unlisten runs against a window that has none (seen on Linux CI).
  await new Promise((r) => setTimeout(r));
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
const inks = () => document.querySelectorAll('path.leaf-ink:not(.leaf-ink-live)');
const liveInks = () => document.querySelectorAll('path.leaf-ink-live');

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

  it('shows the host’s ink; the host’s undo takes its own stroke, and its clear wipes the canvas for everyone', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit({ type: 'ink', peer: 'host', stroke: hostStroke({ id: 'k1' }) }));
    act(() => s.emit({ type: 'ink', peer: 'host', stroke: hostStroke({ id: 'k2' }) }));
    expect(inks()).toHaveLength(2);
    act(() => useStage.setState({ tool: 'pencil' }));
    drawOne();
    expect(inks()).toHaveLength(3);
    act(() =>
      s.emit({ type: 'inkUndo', peer: 'host', docPath: 'a.mmd', blockHash: HASH, strokeId: 'k1' }),
    );
    expect(useAnnotations.getState().strokes.map((k) => k.id)).not.toContain('k1');
    expect(inks()).toHaveLength(2);
    act(() =>
      s.emit({ type: 'inking', peer: 'v1', stroke: hostStroke({ id: 'd1', sticky: false }) }),
    );
    expect(liveInks()).toHaveLength(1);
    act(() => s.emit({ type: 'inkClear', peer: 'host', docPath: 'a.mmd', blockHash: HASH }));
    expect(inks()).toHaveLength(0);
    expect(liveInks()).toHaveLength(0);
    expect(useAnnotations.getState().strokes).toEqual([]);
  });

  it('an inking frame for a stroke that already finished here is ignored', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit({ type: 'ink', peer: 'v1', stroke: hostStroke({ id: 'd1' }) }));
    act(() =>
      s.emit({ type: 'inking', peer: 'v1', stroke: hostStroke({ id: 'd1', sticky: false }) }),
    );
    expect(liveInks()).toHaveLength(0);
    expect(inks()).toHaveLength(1);
  });

  it('a peer’s stroke in progress goes when the peer leaves', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit(presence({ viewers: [v('v1', 'Ada', 'a.mmd'), v('v2', 'Grace')] })));
    act(() =>
      s.emit({ type: 'inking', peer: 'v1', stroke: hostStroke({ id: 'd1', sticky: false }) }),
    );
    expect(liveInks()).toHaveLength(1);
    act(() => s.emit(presence({ viewers: [v('v2', 'Grace')] })));
    expect(liveInks()).toHaveLength(0);
  });

  it('a viewer back on a document keeps only the host ink the relay sends again', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit({ type: 'ink', peer: 'host', stroke: hostStroke({ id: 'k1' }) }));
    expect(inks()).toHaveLength(1);
    // Away on another file, the host clears a.mmd; the viewer, not on it, never hears.
    act(() => useDocuments.getState().open('note.md'));
    act(() => useDocuments.getState().open('a.mmd'));
    const remote = () => useAnnotations.getState().strokes.filter((k) => k.peer);
    expect(remote()).toEqual([]);
    await waitFor(() => expect(ofType(s, 'at').at(-1)).toEqual({ type: 'at', path: 'a.mmd' }));
    act(() => s.emit({ type: 'ink', peer: 'host', stroke: hostStroke({ id: 'k1' }) }));
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
    expect(s.sent.at(-1)).toEqual({
      type: 'inkUndo',
      docPath: 'a.mmd',
      blockHash: HASH,
      strokeId: mine.id,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(ofType(s, 'inkUndo')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawings' }));
    expect(s.sent.at(-1)).toEqual({ type: 'inkClear', docPath: 'a.mmd', blockHash: HASH });
    act(() => useDocuments.getState().open('note.md'));
    await screen.findByRole('heading', { name: 'Note', level: 1 });
    expect(ofType(s, 'stage').at(-1)).toEqual({ type: 'stage' });
    expect(ofType(s, 'pointer').at(-1)).toEqual({ type: 'pointer' });
  });

  it('the host’s Clear wipes every peer’s ink on its own page too', async () => {
    asHost();
    const s = await openFile('a.mmd');
    fireEvent.click(screen.getByRole('button', { name: 'Pencil' }));
    drawOne();
    act(() => s.emit({ type: 'ink', peer: 'v1', stroke: hostStroke({ id: 'a1' }) }));
    act(() => s.emit({ type: 'ink', peer: 'v2', stroke: hostStroke({ id: 'b1' }) }));
    act(() => s.emit({ type: 'inking', peer: 'v1', stroke: hostStroke({ id: 'd1' }) }));
    // Ink on another canvas is not this Clear's to take.
    act(() =>
      s.emit({ type: 'ink', peer: 'v1', stroke: hostStroke({ id: 'o1', blockHash: 'other' }) }),
    );
    expect(inks()).toHaveLength(3);
    expect(liveInks()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawings' }));
    expect(inks()).toHaveLength(0);
    expect(liveInks()).toHaveLength(0);
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['o1']);
  });

  it('a viewer’s Clear leaves the others’ ink on its page', async () => {
    const s = await openFile('a.mmd', SHARE);
    fireEvent.click(screen.getByRole('button', { name: 'Pencil' }));
    drawOne();
    act(() => s.emit({ type: 'ink', peer: 'host', stroke: hostStroke({ id: 'k1' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawings' }));
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['k1']);
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

  it('a viewer sends each finished stroke, its undo and its clear, but never a stage', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => useStage.setState({ tool: 'pencil' }));
    drawOne();
    const mine = useAnnotations.getState().strokes[0]!;
    expect(ofType(s, 'ink')).toEqual([{ type: 'ink', stroke: mine }]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(s.sent.at(-1)).toEqual({
      type: 'inkUndo',
      docPath: 'a.mmd',
      blockHash: HASH,
      strokeId: mine.id,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawings' }));
    expect(s.sent.at(-1)).toEqual({ type: 'inkClear', docPath: 'a.mmd', blockHash: HASH });
    cleanup();
    expect(ofType(s, 'stage')).toEqual([]);
  });

  it('a stroke streams while it is drawn: inking frames carry the new points, then ink the whole', async () => {
    const s = await openFile('a.mmd', SHARE);
    vi.useFakeTimers();
    act(() => useStage.setState({ tool: 'pencil' }));
    const t = viewport();
    fireEvent.pointerDown(t, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(t, { clientX: 40, clientY: 30, pointerId: 1 });
    expect(ofType(s, 'inking')).toHaveLength(1);
    expect(ofType(s, 'inking')[0]).toMatchObject({ stroke: { docPath: 'a.mmd', blockHash: HASH } });
    fireEvent.pointerMove(t, { clientX: 50, clientY: 40, pointerId: 1 });
    expect(ofType(s, 'inking')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(60));
    expect(ofType(s, 'inking')).toHaveLength(2);
    fireEvent.pointerMove(t, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(t, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(100));
    const frames = ofType(s, 'inking') as { stroke: Stroke }[];
    const whole = (ofType(s, 'ink')[0] as { stroke: Stroke }).stroke;
    expect(frames.every((f) => f.stroke.id === whole.id)).toBe(true);
    expect(frames.flatMap((f) => f.stroke.points)).toEqual(whole.points.slice(0, -1));
    expect(whole.points).toHaveLength(4);
    expect(ofType(s, 'inking')).toHaveLength(2);
  });

  it('another peer’s stroke in progress is drawn live, then replaced by the finished stroke', async () => {
    const s = await openFile('a.mmd', SHARE);
    const draft = (points: [number, number][]) => hostStroke({ id: 'd1', points, sticky: false });
    act(() =>
      s.emit({
        type: 'inking',
        peer: 'v1',
        stroke: draft([
          [1, 1],
          [2, 2],
        ]),
      }),
    );
    expect(liveInks()).toHaveLength(1);
    act(() => s.emit({ type: 'inking', peer: 'v1', stroke: draft([[3, 3]]) }));
    expect(liveInks()[0]!.getAttribute('d')).toBe('M1 1 L2 2 L3 3');
    // A frame for another canvas is not drawn here.
    act(() =>
      s.emit({
        type: 'inking',
        peer: 'v3',
        stroke: { ...draft([[1, 1]]), id: 'd2', blockHash: 'x' },
      }),
    );
    expect(liveInks()).toHaveLength(1);
    act(() =>
      s.emit({
        type: 'ink',
        peer: 'v1',
        stroke: draft([
          [1, 1],
          [2, 2],
          [3, 3],
          [4, 4],
        ]),
      }),
    );
    expect(liveInks()).toHaveLength(0);
    expect(inks()).toHaveLength(1);
    expect(useAnnotations.getState().strokes[0]).toMatchObject({ id: 'd1', peer: 'v1' });
  });

  it('a stroke in progress that stops arriving is dropped', async () => {
    const s = await openFile('a.mmd', SHARE);
    vi.useFakeTimers();
    act(() =>
      s.emit({ type: 'inking', peer: 'v1', stroke: hostStroke({ id: 'd1', sticky: false }) }),
    );
    expect(liveInks()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(INK_DRAFT_STALE_MS + 1000));
    expect(liveInks()).toHaveLength(0);
  });

  it('a peer’s undo and clear touch only that peer’s strokes', async () => {
    const s = await openFile('a.mmd', SHARE);
    act(() => s.emit({ type: 'ink', peer: 'host', stroke: hostStroke({ id: 'k1' }) }));
    act(() => s.emit({ type: 'ink', peer: 'v1', stroke: hostStroke({ id: 'a1' }) }));
    act(() => s.emit({ type: 'ink', peer: 'v1', stroke: hostStroke({ id: 'a2' }) }));
    const ids = () => useAnnotations.getState().strokes.map((k) => k.id);
    act(() => s.emit({ type: 'inkUndo', peer: 'v1', docPath: 'a.mmd', blockHash: HASH }));
    expect(ids()).toEqual(['k1', 'a1']);
    act(() => s.emit({ type: 'inkClear', peer: 'v1', docPath: 'a.mmd', blockHash: HASH }));
    expect(ids()).toEqual(['k1']);
    act(() => s.emit({ type: 'inkClear', peer: 'host', docPath: 'a.mmd', blockHash: HASH }));
    expect(ids()).toEqual([]);
  });

  it('a page outside a share sends nothing', async () => {
    const s = await openFile('a.mmd');
    fireEvent.pointerMove(viewport(), { clientX: 10, clientY: 20, pointerId: 1 });
    act(() => useStage.setState({ tool: 'pencil' }));
    drawOne();
    cleanup();
    expect(ofType(s, 'stage', 'pointer', 'ink', 'inking', 'inkUndo', 'inkClear')).toEqual([]);
  });
});
