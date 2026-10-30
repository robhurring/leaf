import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FileMessage } from '@leaf/protocol';
import { registries } from '../src/render/registries/index.js';
import { DocumentView } from '../src/components/DocumentView.js';
import { DocToolsContext } from '../src/components/Properties.js';

const CSV = 'name,size\na,1\nb,2\n';

describe('CSV source and copy', () => {
  it('a CSV block flips to its source from the hover tools', async () => {
    const el = registries.blocks
      .resolve('csv')!
      .render(CSV, '', { docPath: 'd.md', config: {} }) as ReactElement;
    render(el);
    const tools = screen.getByRole('group', { name: 'Block tools' });
    fireEvent.click(within(tools).getByRole('button', { name: 'Show source' }));
    expect(screen.queryByRole('table')).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('.leaf-block-source')!.textContent).toContain('name,size'),
    );
    fireEvent.click(within(tools).getByRole('button', { name: 'Show source' }));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('a whole .csv file has Show source and Copy in the file toolbar', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
    const file: FileMessage = {
      type: 'file',
      path: 'data.csv',
      kind: 'text',
      lang: 'csv',
      mime: 'text/csv',
      encoding: 'utf8',
      content: CSV,
      url: '',
      size: CSV.length,
      mtime: 1,
    };
    const slot = document.createElement('div');
    document.body.append(slot);
    render(
      <DocToolsContext.Provider value={slot}>
        <DocumentView
          file={file}
          path="data.csv"
          config={{}}
          numbering={false}
          linkBase=""
          onNavigate={() => {}}
        />
      </DocToolsContext.Provider>,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    // Copy comes first, as in a block's tools.
    expect(
      within(slot)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Copy source', 'Show source']);
    fireEvent.click(within(slot).getByRole('button', { name: 'Copy source' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CSV);
    fireEvent.click(within(slot).getByRole('button', { name: 'Show source' }));
    expect(screen.queryByRole('table')).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('.leaf-block-source')!.textContent).toContain('a,1'),
    );
  });
});
