import { describe, it, expect, beforeEach } from 'vitest';
import { POINTER_STALE_MS, pointersOn, usePointers } from '../src/share/pointers.js';

const at = (x: number, docPath = 'a.mmd', blockHash = 'h1') => ({ docPath, blockHash, x, y: 1 });

beforeEach(() => usePointers.getState().clear());

describe('peers’ pointers', () => {
  it('move sets a peer’s pointer and move without one removes it', () => {
    usePointers.getState().move('v1', at(5));
    expect(usePointers.getState().pointers.v1).toMatchObject(at(5));
    usePointers.getState().move('v1', undefined);
    expect(usePointers.getState().pointers.v1).toBeUndefined();
  });

  it('pointersOn keeps only the pointers on that canvas', () => {
    usePointers.getState().move('v1', at(5));
    usePointers.getState().move('v2', at(6, 'b.mmd'));
    usePointers.getState().move('v3', at(7, 'a.mmd', 'h2'));
    expect(pointersOn(usePointers.getState().pointers, 'a.mmd', 'h1')).toEqual([['v1', at(5)]]);
  });

  it('sweep drops pointers that have not moved for a while', () => {
    usePointers.getState().move('v1', at(5));
    const { at: when } = usePointers.getState().pointers.v1!;
    usePointers.getState().sweep(when + POINTER_STALE_MS - 1);
    expect(usePointers.getState().pointers.v1).toBeDefined();
    usePointers.getState().sweep(when + POINTER_STALE_MS);
    expect(usePointers.getState().pointers.v1).toBeUndefined();
  });
});
