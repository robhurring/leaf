import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useDocuments } from '../src/store/documents.js';
import { useDataFile } from '../src/data/useDataFile.js';
import { scripted } from './helpers/scripted.js';

function Show({ rel }: { rel: string }) {
  const f = useDataFile('notes/plan.md', rel);
  return <div data-testid="out">{f.error ?? f.text ?? 'loading'}</div>;
}

beforeEach(() => useDocuments.getState().reset());

describe('data files a document reads', () => {
  it('reads a file next to the document, and again when it changes', async () => {
    const s = scripted({ 'notes/plan.md': '# x', 'notes/data/sales.csv': 'a\n1\n' });
    useDocuments.getState().attach(s.source);
    render(<Show rel="./data/sales.csv" />);
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('a\n1\n'));
    s.files['notes/data/sales.csv'] = 'a\n2\n';
    act(() => s.emit({ type: 'changed', path: 'notes/data/sales.csv', change: 'modified' }));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('a\n2\n'));
  });

  it('says when the file is missing', async () => {
    const s = scripted({ 'notes/plan.md': '# x' });
    useDocuments.getState().attach(s.source);
    render(<Show rel="gone.csv" />);
    await waitFor(() => expect(screen.getByTestId('out').textContent).toMatch(/notes\/gone\.csv/));
  });
});
