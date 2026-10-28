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
