import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { parseDelimited } from '../src/viewers/csv/parse.js';
import { csv } from '../src/viewers/csv/index.js';
import { viewers } from '../src/viewers/index.js';
import type { FileMessage } from '@leaf/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown } from '../src/render/pipeline.js';

const file = (path: string, content: string): FileMessage => ({
  type: 'file',
  path,
  kind: 'text',
  mime: 'text/csv',
  encoding: 'utf8',
  content,
  url: '/raw/' + path,
  size: content.length,
  mtime: 1,
});

describe('parseDelimited', () => {
  it('handles quotes, escaped quotes, and tabs', () => {
    expect(parseDelimited('a,b\n"x, y","he said ""hi"""\n', ',')).toEqual({
      header: ['a', 'b'],
      rows: [['x, y', 'he said "hi"']],
    });
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual({ header: ['a', 'b'], rows: [['1', '2']] });
  });
  it('guesses the delimiter', () => expect(parseDelimited('a;b\n1;2').header).toEqual(['a', 'b']));
});

describe('csv viewer', () => {
  const data = 'name,size\nzeta,10\nalpha,200\nmid,3\n';
  it('renders a fenced csv block as a table', async () => {
    const r = await renderMarkdown('```csv\n' + data + '```\n', { docPath: 'a.md', config: {} });
    const h = renderToStaticMarkup(r.element);
    expect(h).toContain('<table');
    expect(h).toContain('alpha');
    expect(h).not.toContain('leaf-codeblock');
  });
  it('is picked for csv and tsv files', () => {
    expect(viewers.forFile(file('data.csv', data)).id).toBe('csv');
    expect(
      viewers.forFile({ ...file('data.tsv', data), mime: 'text/tab-separated-values' }).id,
    ).toBe('csv');
    expect(viewers.forLang('csv')?.id).toBe('csv');
  });
  it('renders a table that sorts by header click and filters', () => {
    render(
      <csv.Rich file={file('data.csv', data)} content={data} docPath="data.csv" config={{}} />,
    );
    const table = screen.getByRole('table');
    const firstCol = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelector('td')!.textContent);
    expect(firstCol()).toEqual(['zeta', 'alpha', 'mid']);
    fireEvent.click(within(table).getByRole('columnheader', { name: /size/ }));
    expect(firstCol()).toEqual(['mid', 'zeta', 'alpha']);
    fireEvent.click(within(table).getByRole('columnheader', { name: /size/ }));
    expect(firstCol()).toEqual(['alpha', 'zeta', 'mid']);
    fireEvent.change(screen.getByRole('searchbox', { name: /filter rows/i }), {
      target: { value: 'alp' },
    });
    expect(firstCol()).toEqual(['alpha']);
  });
});
