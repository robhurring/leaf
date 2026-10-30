import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { scripted } from './helpers/scripted.js';

const DOC = '# Plan\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';

describe('markdown source', () => {
  it('a markdown file shows its source and copies it from the file toolbar', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Reader source={scripted({ 'plan.md': DOC }).source} />);
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeTruthy();
    const tools = screen.getByRole('toolbar', { name: 'File tools' });
    // Source on the left, copy on its right, as everywhere else.
    const labels = within(tools)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels.indexOf('Show source')).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf('Copy source')).toBe(labels.indexOf('Show source') + 1);
    fireEvent.click(within(tools).getByRole('button', { name: 'Copy source' }));
    expect(writeText).toHaveBeenCalledWith(DOC);
    fireEvent.click(within(tools).getByRole('button', { name: 'Show source' }));
    await waitFor(() =>
      expect(document.querySelector('.leaf-block-source')!.textContent).toContain('| 1 | 2 |'),
    );
    expect(screen.queryByRole('heading', { name: 'Plan' })).toBeNull();
    fireEvent.click(within(tools).getByRole('button', { name: 'Show source' }));
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeTruthy();
  });
});
