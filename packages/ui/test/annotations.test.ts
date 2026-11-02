import { describe, it, expect, beforeEach } from 'vitest';
import { INK_GONE_MS, strokesFor, useAnnotations, type Stroke } from '../src/store/annotations.js';

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

beforeEach(() => useAnnotations.setState({ strokes: [] }));

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

describe('ink from the relay', () => {
  it('addRemote adds a stroke marked with its peer, once per id', () => {
    const k = stroke({ id: 'r1', peer: 'host' });
    useAnnotations.getState().addRemote(k);
    useAnnotations.getState().addRemote(k); // a reconnecting viewer gets the kept strokes again
    const strokes = useAnnotations.getState().strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ id: 'r1', peer: 'host' });
  });

  it('undo and clear leave remote strokes alone', () => {
    useAnnotations.getState().add(stroke({ id: 'mine' }));
    useAnnotations.getState().addRemote(stroke({ id: 'theirs', peer: 'host' }));
    useAnnotations.getState().undo('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['theirs']);
    useAnnotations.getState().add(stroke({ id: 'mine2' }));
    useAnnotations.getState().clear('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['theirs']);
  });

  it('undoRemote removes only the last remote stroke of that canvas', () => {
    const s = useAnnotations.getState();
    s.addRemote(stroke({ id: 'r1', peer: 'host' }));
    s.addRemote(stroke({ id: 'r2', peer: 'host' }));
    s.addRemote(stroke({ id: 'other', peer: 'host', blockHash: 'h2' }));
    s.add(stroke({ id: 'mine' }));
    useAnnotations.getState().undoRemote('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['r1', 'other', 'mine']);
  });

  it('clearRemote removes only remote strokes of that canvas', () => {
    const s = useAnnotations.getState();
    s.addRemote(stroke({ id: 'r1', peer: 'host' }));
    s.addRemote(stroke({ id: 'other', peer: 'host', blockHash: 'h2' }));
    s.add(stroke({ id: 'mine' }));
    useAnnotations.getState().clearRemote('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((k) => k.id)).toEqual(['other', 'mine']);
  });
});
