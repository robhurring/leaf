import { describe, it, expect } from 'vitest';
import { dragged, dropIndex } from '../src/chrome/drag.js';

describe('dragging a tab', () => {
  it('takes a tab off the row past 30px down, or off either side', () => {
    const start = { x: 100, y: 10 };
    expect(dragged('tab', start, { x: 100, y: 30 }, 800)).toBe(false);
    expect(dragged('tab', start, { x: 100, y: 41 }, 800)).toBe(true);
    expect(dragged('tab', start, { x: -1, y: 10 }, 800)).toBe(true);
    expect(dragged('tab', start, { x: 801, y: 10 }, 800)).toBe(true);
    // Sideways along the row is reordering, not dragging out.
    expect(dragged('tab', start, { x: 400, y: 12 }, 800)).toBe(false);
  });

  it('takes the leaf mark after a few pixels any way', () => {
    const start = { x: 100, y: 10 };
    expect(dragged('mark', start, { x: 105, y: 10 }, 800)).toBe(false);
    expect(dragged('mark', start, { x: 109, y: 10 }, 800)).toBe(true);
    expect(dragged('mark', start, { x: 100, y: 19 }, 800)).toBe(true);
  });

  it('drops before the first tab whose middle is right of the pointer', () => {
    // three tabs 100px wide from 0
    const lefts = [0, 100, 200];
    expect(dropIndex(10, lefts, 100)).toBe(0);
    expect(dropIndex(60, lefts, 100)).toBe(1);
    expect(dropIndex(149, lefts, 100)).toBe(1);
    expect(dropIndex(151, lefts, 100)).toBe(2);
    expect(dropIndex(290, lefts, 100)).toBe(3);
    expect(dropIndex(10, [], 100)).toBe(0);
  });
});
