import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
});

describe('Tree', () => {
  it('filter narrows rows and asks the server', async () => {
    const { source, sent } = scripted({
      'README.md': README,
      'docs/guide.md': GUIDE,
      'docs/deep/far.md': '# far',
    });
    render(<Reader source={source} />);
    await screen.findByRole('heading', { level: 1 });
    const files = screen.getByRole('navigation', { name: 'Files' });
    fireEvent.change(within(files).getByRole('searchbox', { name: 'Filter files' }), {
      target: { value: 'far' },
    });
    await waitFor(() => expect(sent.some((m) => m.type === 'search' && m.q === 'far')).toBe(true));
    expect(await within(files).findByText('docs/deep/far.md')).toBeTruthy();
    expect(within(files).queryByText('README.md')).toBeNull();
  });

  it('expand all and collapse all', async () => {
    const { source } = scripted({ 'README.md': README, 'docs/guide.md': GUIDE });
    render(<Reader source={source} />);
    await screen.findByRole('heading', { level: 1 });
    const files = screen.getByRole('navigation', { name: 'Files' });
    fireEvent.click(within(files).getByRole('button', { name: 'Expand all' }));
    expect(await within(files).findByText('guide.md')).toBeTruthy();
    fireEvent.click(within(files).getByRole('button', { name: 'Collapse all' }));
    expect(within(files).queryByText('guide.md')).toBeNull();
  });
});
