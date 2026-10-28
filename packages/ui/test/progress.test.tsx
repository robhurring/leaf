import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { track, useProgress } from '../src/render/progress.js';
import { ProgressBar } from '../src/components/ProgressBar.js';

afterEach(() => vi.useRealTimers());

describe('progress bar', () => {
  it('shows while something loads (after a short delay so quick loads never flash) and hides when done', async () => {
    vi.useFakeTimers();
    const { container } = render(<ProgressBar />);
    let finish!: () => void;
    act(() => {
      void track(new Promise<void>((r) => (finish = r)));
    });
    expect(useProgress.getState().pending).toBe(1);
    expect(container.querySelector('.leaf-progress')).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector('.leaf-progress[role="progressbar"]')).toBeTruthy();
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useProgress.getState().pending).toBe(0);
    expect(container.querySelector('.leaf-progress')).toBeNull();
  });

  it('a failed load still ends the bar', async () => {
    await track(Promise.reject(new Error('x'))).catch(() => {});
    expect(useProgress.getState().pending).toBe(0);
  });
});
