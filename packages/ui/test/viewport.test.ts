import { describe, it, expect } from 'vitest';
import { createViewport, MAX_SCALE, MIN_SCALE } from '../src/stage/viewport.js';

describe('viewport', () => {
  it('starts at identity and pans', () => {
    const v = createViewport();
    expect(v.get()).toEqual({ scale: 1, x: 0, y: 0 });
    v.panBy(10, -5);
    expect(v.get()).toEqual({ scale: 1, x: 10, y: -5 });
  });

  it('zooms around a point so that point stays fixed', () => {
    const v = createViewport();
    v.zoomAt({ x: 100, y: 50 }, 2);
    const { scale, x, y } = v.get();
    expect(scale).toBe(2);
    // content point under (100,50) before: (100,50); after: (100*2 + x, 50*2 + y) must equal (100,50)
    expect(100 * scale + x).toBe(100);
    expect(50 * scale + y).toBe(50);
  });

  it('clamps scale', () => {
    const v = createViewport();
    v.zoomAt({ x: 0, y: 0 }, 1000);
    expect(v.get().scale).toBe(MAX_SCALE);
    v.zoomAt({ x: 0, y: 0 }, 0.00001);
    expect(v.get().scale).toBe(MIN_SCALE);
  });

  it('fits content into the view with a margin and reset returns to identity', () => {
    const v = createViewport();
    v.fit(2000, 1000, 1000, 1000, 50);
    const { scale, x, y } = v.get();
    expect(scale).toBeCloseTo(0.45);
    expect(x).toBeCloseTo((1000 - 2000 * scale) / 2);
    expect(y).toBeCloseTo((1000 - 1000 * scale) / 2);
    v.reset();
    expect(v.get()).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('converts view coordinates to content coordinates', () => {
    const v = createViewport();
    v.zoomAt({ x: 0, y: 0 }, 2);
    v.panBy(10, 20);
    expect(v.toContent({ x: 110, y: 220 })).toEqual({ x: 50, y: 100 });
  });
});
