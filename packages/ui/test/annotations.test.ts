import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  INK_GONE_MS,
  MAX_DRAFT_POINTS,
  MAX_HOST_STICKY,
  MAX_VIEWER_STICKY,
  strokesFor,
  useAnnotations,
  type Stroke,
} from '../src/store/annotations.js';

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  id: Math.random().toString(36).slice(2),
  docPath: 'a.md',
  blockHash: 'h1',
  points: [
    [0, 0],
    [10, 10],
  ],
  color: 'red',
  width: 4,
  sticky: false,
  createdAt: 1000,
  ...over,
});

beforeEach(() => useAnnotations.setState({ strokes: [], drafts: {} }));

describe('annotations store', () => {
  it('keeps strokes per document and block', () => {
    useAnnotations.getState().add(stroke());
    useAnnotations.getState().add(stroke({ blockHash: 'h2' }));
    useAnnotations.getState().add(stroke({ docPath: 'b.md' }));
    expect(strokesFor(useAnnotations.getState().strokes, 'a.md', 'h1')).toHaveLength(1);
    useAnnotations.getState().clear('a.md', 'h1');
    expect(strokesFor(useAnnotations.getState().strokes, 'a.md', 'h1')).toHaveLength(0);
    expect(useAnnotations.getState().strokes).toHaveLength(2);
  });

  it('invisible ink expires after INK_GONE_MS; sticky strokes stay for the session', () => {
    useAnnotations.getState().add(stroke({ createdAt: 0 }));
    useAnnotations.getState().add(stroke({ createdAt: 0, sticky: true }));
    useAnnotations.getState().expire(INK_GONE_MS - 1);
    expect(useAnnotations.getState().strokes).toHaveLength(2);
    useAnnotations.getState().expire(INK_GONE_MS + 1);
    expect(useAnnotations.getState().strokes.map((s) => s.sticky)).toEqual([true]);
  });

  it('marks sticky strokes stale when their block hash is no longer in the document', () => {
    useAnnotations.getState().add(stroke({ sticky: true, blockHash: 'old' }));
    useAnnotations.getState().add(stroke({ sticky: true, blockHash: 'live' }));
    useAnnotations.getState().markStale('a.md', ['live']);
    expect(useAnnotations.getState().strokes.map((s) => [s.blockHash, s.stale])).toEqual([
      ['old', true],
      ['live', false],
    ]);
  });

  it('tracking live blocks marks sticky strokes stale when their block disappears, and fresh again if it returns', () => {
    useAnnotations.getState().add(stroke({ sticky: true, blockHash: 'h1' }));
    const untrack = useAnnotations.getState().trackBlock('a.md', 'h1');
    expect(useAnnotations.getState().strokes[0]!.stale).toBeFalsy();
    untrack();
    expect(useAnnotations.getState().strokes[0]!.stale).toBe(true);
    useAnnotations.getState().trackBlock('a.md', 'h1');
    expect(useAnnotations.getState().strokes[0]!.stale).toBe(false);
    expect(useAnnotations.getState().isLive('a.md', 'h1')).toBe(true);
    expect(useAnnotations.getState().isLive('a.md', 'nope')).toBe(false);
  });

  it('never touches localStorage', () => {
    useAnnotations.getState().add(stroke({ sticky: true }));
    expect(Object.keys(localStorage).some((k) => /annot|ink|stroke/i.test(k))).toBe(false);
  });
});

describe('invisible ink timing', () => {
  it('is gone in 3s, and the fade animation ends when the timer drops it', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'leaf.css'), 'utf8');
    expect(INK_GONE_MS).toBe(3000);
    const s = `${INK_GONE_MS / 1000}s`;
    expect(css).toMatch(new RegExp(`\\.leaf-ink-fade \\{\\s*animation: leaf-ink-fade ${s} `));
    expect(css).toMatch(new RegExp(`animation-delay: ${s};`));
  });
});

describe('remote ink with no canvas open', () => {
  afterEach(() => vi.useRealTimers());

  it('a fading stroke from a peer expires though nothing is drawing it', () => {
    vi.useFakeTimers();
    const a = useAnnotations.getState();
    a.addRemote({ ...stroke({ id: 'f1' }), peer: 'v1' });
    a.addRemote({ ...stroke({ id: 's1', sticky: true }), peer: 'v1' });
    vi.advanceTimersByTime(INK_GONE_MS + 1000);
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['s1']);
    // Nothing left to sweep: the timer is let go.
    expect(vi.getTimerCount()).toBe(0);
    // And it starts again for the next one.
    a.addRemote({ ...stroke({ id: 'f2' }), peer: 'v1' });
    vi.advanceTimersByTime(INK_GONE_MS + 1000);
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['s1']);
  });

  it('the sweep outlasts the drafts while a fading stroke is left', () => {
    vi.useFakeTimers();
    const a = useAnnotations.getState();
    a.draft('v1', stroke({ id: 'd1' }));
    vi.advanceTimersByTime(2500);
    // The draft finishes as a fading stroke just before it would have gone stale.
    a.addRemote({ ...stroke({ id: 'd1' }), peer: 'v1' });
    vi.advanceTimersByTime(1000);
    expect(useAnnotations.getState().strokes).toHaveLength(1);
    vi.advanceTimersByTime(INK_GONE_MS);
    expect(useAnnotations.getState().strokes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('how much of a peer’s kept ink a page holds', () => {
  const ids = (peer: string, blockHash = 'h1') =>
    useAnnotations
      .getState()
      .strokes.filter((k) => k.peer === peer && k.blockHash === blockHash)
      .map((k) => k.id);
  const fill = (peer: string, n: number, over: Partial<Stroke> = {}) => {
    for (let i = 0; i < n; i++)
      useAnnotations.getState().addRemote({
        ...stroke({ id: `${peer}-${over.blockHash ?? 'h1'}-${i}`, sticky: true, ...over }),
        peer,
      });
  };

  it('a viewer’s sticky strokes on a canvas stop at 100, the oldest going first', () => {
    expect(MAX_VIEWER_STICKY).toBe(100);
    fill('v1', 103);
    expect(ids('v1')).toHaveLength(100);
    expect(ids('v1')[0]).toBe('v1-h1-3');
    expect(ids('v1').at(-1)).toBe('v1-h1-102');
  });

  it('the host’s stop at 200', () => {
    expect(MAX_HOST_STICKY).toBe(200);
    fill('host', 202);
    expect(ids('host')).toHaveLength(200);
    expect(ids('host')[0]).toBe('host-h1-2');
  });

  it('each peer and each canvas is counted apart, and this page’s own are not counted', () => {
    fill('v1', 100);
    fill('v2', 100);
    fill('v1', 100, { blockHash: 'h2' });
    for (let i = 0; i < 150; i++)
      useAnnotations.getState().add(stroke({ id: `own-${i}`, sticky: true }));
    fill('v1', 1, { id: 'one-more' });
    expect(ids('v1')).toHaveLength(100);
    expect(ids('v1')[0]).toBe('v1-h1-1');
    expect(ids('v2')).toHaveLength(100);
    expect(ids('v1', 'h2')).toHaveLength(100);
    expect(useAnnotations.getState().strokes.filter((k) => !k.peer)).toHaveLength(150);
  });

  it('fading strokes are not counted and push nothing out', () => {
    fill('v1', 100);
    for (let i = 0; i < 5; i++)
      useAnnotations.getState().addRemote({ ...stroke({ id: `fade-${i}` }), peer: 'v1' });
    expect(ids('v1')).toHaveLength(105);
    expect(ids('v1')[0]).toBe('v1-h1-0');
  });
});

describe('ink from the relay', () => {
  it('addRemote adds a stroke marked with its peer, once per id', () => {
    const k = { ...stroke({ id: 'r1' }), peer: 'host' };
    useAnnotations.getState().addRemote(k);
    useAnnotations.getState().addRemote(k); // a reconnecting viewer gets the kept strokes again
    const strokes = useAnnotations.getState().strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ id: 'r1', peer: 'host' });
  });

  it('undo and clear leave remote strokes alone', () => {
    useAnnotations.getState().add(stroke({ id: 'mine' }));
    useAnnotations.getState().addRemote({ ...stroke({ id: 'theirs' }), peer: 'host' });
    useAnnotations.getState().undo('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['theirs']);
    useAnnotations.getState().add(stroke({ id: 'mine2' }));
    useAnnotations.getState().clear('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['theirs']);
  });

  it('undoRemote removes only that peer’s last stroke on that canvas', () => {
    const s = useAnnotations.getState();
    s.addRemote({ ...stroke({ id: 'r1' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'r2' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'other', blockHash: 'h2' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'v' }), peer: 'v1' });
    s.add(stroke({ id: 'mine' }));
    useAnnotations.getState().undoRemote('a.md', 'h1', 'host');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual([
      'r1',
      'other',
      'v',
      'mine',
    ]);
  });

  it('clearRemote removes only that peer’s strokes on that canvas', () => {
    const s = useAnnotations.getState();
    s.addRemote({ ...stroke({ id: 'r1' }), peer: 'v1' });
    s.addRemote({ ...stroke({ id: 'other', blockHash: 'h2' }), peer: 'v1' });
    s.addRemote({ ...stroke({ id: 'v' }), peer: 'v2' });
    s.add(stroke({ id: 'mine' }));
    useAnnotations.getState().clearRemote('a.md', 'h1', 'v1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['other', 'v', 'mine']);
  });

  it('clearRemoteFor removes every remote stroke of that document and nothing else', () => {
    const s = useAnnotations.getState();
    s.addRemote({ ...stroke({ id: 'r1' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'r2', blockHash: 'h2' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'elsewhere', docPath: 'b.md' }), peer: 'host' });
    s.add(stroke({ id: 'mine' }));
    useAnnotations.getState().clearRemoteFor('a.md');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['elsewhere', 'mine']);
  });

  it('an undo that names a stroke takes that one, and only that peer’s', () => {
    const s = useAnnotations.getState();
    s.addRemote({ ...stroke({ id: 'r1' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'r2' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'v1' }), peer: 'v1' });
    useAnnotations.getState().undoRemote('a.md', 'h1', 'host', 'r1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['r2', 'v1']);
    useAnnotations.getState().undoRemote('a.md', 'h1', 'host', 'v1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['r2', 'v1']);
  });

  it('the host’s clear wipes the canvas for everyone, this page’s own strokes included', () => {
    const s = useAnnotations.getState();
    s.add(stroke({ id: 'mine' }));
    s.addRemote({ ...stroke({ id: 'r1' }), peer: 'host' });
    s.addRemote({ ...stroke({ id: 'v1' }), peer: 'v1' });
    s.addRemote({ ...stroke({ id: 'other', blockHash: 'h2' }), peer: 'v1' });
    useAnnotations.getState().clearRemote('a.md', 'h1', 'host');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['other']);
  });

  it('undo returns the stroke it took back, or nothing', () => {
    const s = useAnnotations.getState();
    s.add(stroke({ id: 'mine' }));
    expect(useAnnotations.getState().undo('a.md', 'h1')?.id).toBe('mine');
    expect(useAnnotations.getState().undo('a.md', 'h1')).toBeUndefined();
  });

  it('a draft stops growing at MAX_DRAFT_POINTS', () => {
    const s = useAnnotations.getState();
    const many = Array.from({ length: MAX_DRAFT_POINTS }, (_, i) => [i, i] as [number, number]);
    s.draft('v1', stroke({ id: 'd', points: many }));
    s.draft('v1', stroke({ id: 'd', points: [[1, 1]] }));
    expect(Object.values(useAnnotations.getState().drafts)[0]!.points).toHaveLength(
      MAX_DRAFT_POINTS,
    );
  });
});
