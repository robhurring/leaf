import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Loading } from '../src/components/Loading.js';
import { Markdown } from '../src/components/Markdown.js';

afterEach(() => vi.useRealTimers());

describe('Loading', () => {
  it('shows nothing at first, then the loader and the file name, so fast opens never flash', () => {
    vi.useFakeTimers();
    render(<Loading label="README.md" />);
    expect(screen.queryByText(/Opening/)).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status').textContent).toContain('Opening README.md');
  });

  it('markdown shows the loader while it renders', () => {
    vi.useFakeTimers();
    render(<Markdown source={'# hi'} docPath="a.md" />);
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector('.leaf-loading')).toBeTruthy();
  });
});
