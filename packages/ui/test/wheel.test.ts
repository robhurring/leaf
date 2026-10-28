import { describe, it, expect } from 'vitest';
import { wheelIntent } from '../src/stage/wheel.js';

describe('wheelIntent', () => {
  it('ctrl+wheel is a trackpad pinch', () => {
    expect(wheelIntent({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -12 })).toBe('pinch');
  });
  it('line or page mode wheels come from a mouse and zoom', () => {
    expect(wheelIntent({ ctrlKey: false, deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe('zoom');
  });
  it('a mouse notch (wheelDelta in multiples of 120) zooms', () => {
    expect(
      wheelIntent({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -120 }),
    ).toBe('zoom');
    expect(
      wheelIntent({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: -200, wheelDeltaY: 240 }),
    ).toBe('zoom');
  });
  it('two-finger trackpad scrolling pans', () => {
    expect(
      wheelIntent({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 3.5, wheelDeltaY: -10 }),
    ).toBe('pan');
    expect(
      wheelIntent({ ctrlKey: false, deltaMode: 0, deltaX: -8, deltaY: 1, wheelDeltaY: -3 }),
    ).toBe('pan');
    expect(wheelIntent({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 40 })).toBe('pan');
  });
});

describe('gestureFactor', () => {
  it('turns cumulative gesture scale into a step factor', async () => {
    const { gestureFactor } = await import('../src/stage/wheel.js');
    expect(gestureFactor(1.5, 1)).toBeCloseTo(1.5);
    expect(gestureFactor(1.8, 1.5)).toBeCloseTo(1.2);
    expect(gestureFactor(0, 1)).toBe(1);
  });
});
