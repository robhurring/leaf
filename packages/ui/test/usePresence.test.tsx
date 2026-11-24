import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePresence } from '../src/usePresence.js';

const motion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }) as unknown as MediaQueryList);

describe('usePresence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a panel open from the start is just open: nothing slides as the page loads', () => {
    motion(false);
    const { result } = renderHook(() => usePresence(true));
    expect(result.current).toBe('open');
  });

  it('opening and closing are states of their own, from the first frame, until the slide is over', () => {
    motion(false);
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(null);
    rerender({ open: true });
    expect(result.current).toBe('opening');
    act(() => void vi.advanceTimersByTime(220));
    expect(result.current).toBe('open');
    rerender({ open: false });
    expect(result.current).toBe('closing');
    act(() => void vi.advanceTimersByTime(220));
    expect(result.current).toBe(null);
  });

  it('with reduced motion a panel is open or gone', () => {
    motion(true);
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    expect(result.current).toBe('open');
    rerender({ open: false });
    expect(result.current).toBe(null);
  });
});
