import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
  Element.prototype.scrollIntoView = vi.fn();
});

const dir = () =>
  scripted({
    'README.md': README,
    'docs/guide.md': GUIDE,
    'docs/api.md': '# API',
    'notes.txt': 'x',
  });

describe('keyboard in lists', () => {
  it('the file filter: ctrl-n/ctrl-p (and arrows) move through matches, Enter opens', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    const input = screen.getByRole('searchbox', { name: 'Filter files' });
    fireEvent.change(input, { target: { value: 'docs' } });
    const list = await screen.findByRole('listbox', { name: 'Matching files' });
    await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(2));
    const active = () => list.querySelector('[data-active="true"]')?.textContent;
    expect(active()).toContain('docs/api.md');
    fireEvent.keyDown(input, { key: 'n', ctrlKey: true });
    expect(active()).toContain('docs/guide.md');
    fireEvent.keyDown(input, { key: 'p', ctrlKey: true });
    expect(active()).toContain('docs/api.md');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(location.pathname).toBe('/docs/guide.md'));
  });

  it('go to keeps the selected row in view as ctrl-n moves', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const box = await screen.findByRole('combobox', { name: 'Go to' });
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.keyDown(box, { key: 'n', ctrlKey: true });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
