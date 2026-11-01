import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FileMessage } from '@leaf/protocol';
import { viewers } from '../src/viewers/index.js';
import { registries } from '../src/render/registries/index.js';
import { parseNotebook } from '../src/viewers/notebook/parse.js';

const NB = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { language: 'python', name: 'python3' } },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Sales\n', '\n', 'A **quick** look.'] },
    {
      cell_type: 'code',
      execution_count: 3,
      metadata: {},
      source: 'total = sum([1, 2, 3])\nprint(total)',
      outputs: [
        { output_type: 'stream', name: 'stdout', text: ['6\n'] },
        {
          output_type: 'execute_result',
          execution_count: 3,
          metadata: {},
          data: { 'text/plain': ['6'], 'text/html': ['<table><tr><td>6</td></tr></table>'] },
        },
      ],
    },
    {
      cell_type: 'code',
      execution_count: 4,
      metadata: {},
      source: '1 / 0',
      outputs: [
        {
          output_type: 'error',
          ename: 'ZeroDivisionError',
          evalue: 'division by zero',
          traceback: ['\u001b[0;31mZeroDivisionError\u001b[0m: division by zero'],
        },
      ],
    },
    {
      cell_type: 'code',
      execution_count: 5,
      metadata: {},
      source: 'plot()',
      outputs: [
        {
          output_type: 'display_data',
          metadata: {},
          data: { 'image/png': 'iVBORw0KGgo=', 'text/plain': ['<Figure>'] },
        },
      ],
    },
  ],
};
const TEXT = JSON.stringify(NB);

describe('notebooks', () => {
  it('reads cells, joins their lines, and strips terminal colors from tracebacks', () => {
    const nb = parseNotebook(TEXT);
    expect(nb.language).toBe('python');
    expect(nb.cells.map((c) => c.type)).toEqual(['markdown', 'code', 'code', 'code']);
    expect(nb.cells[0]!.source).toBe('# Sales\n\nA **quick** look.');
    const err = nb.cells[2]!.outputs[0]!;
    expect(err).toEqual({
      kind: 'error',
      name: 'ZeroDivisionError',
      value: 'division by zero',
      traceback: 'ZeroDivisionError: division by zero',
    });
    // The richest form of each output is kept.
    expect(nb.cells[1]!.outputs.map((o) => o.kind)).toEqual(['stream', 'html']);
    expect(nb.cells[3]!.outputs[0]).toEqual({
      kind: 'image',
      mime: 'image/png',
      src: 'data:image/png;base64,iVBORw0KGgo=',
    });
  });

  it('says what is wrong with something that is not a notebook', () => {
    expect(() => parseNotebook('{"cells": 3}')).toThrow(/notebook/);
    expect(() => parseNotebook('nope')).toThrow();
  });

  it('.ipynb files and ```ipynb fences are notebooks', () => {
    const f: FileMessage = {
      type: 'file',
      path: 'a.ipynb',
      kind: 'text',
      lang: 'json',
      mime: 'application/json',
      encoding: 'utf8',
      content: TEXT,
      url: '',
      size: 1,
      mtime: 1,
    };
    expect(viewers.forFile(f).id).toBe('notebook');
    expect(viewers.forLang('ipynb')?.id).toBe('notebook');
  });

  it('draws markdown, code with its count, outputs, and errors; code can be hidden', async () => {
    const el = registries.blocks
      .resolve('ipynb')!
      .render(TEXT, '', { docPath: 'doc.md', config: {} }) as ReactElement;
    render(el);
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeTruthy();
    expect(screen.getAllByText('[3]').length).toBeGreaterThan(0);
    expect(screen.getByText('6', { selector: 'pre' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('ZeroDivisionError');
    expect(document.querySelector('img.leaf-nb-image')!.getAttribute('src')).toMatch(
      /^data:image\/png/,
    );
    // HTML output runs sealed off, like a live pane.
    expect(document.querySelector('iframe.leaf-nb-html')!.getAttribute('sandbox')).toBe(
      'allow-scripts',
    );
    await waitFor(() => expect(document.querySelector('.leaf-nb-code')).toBeTruthy());
    // The toggle sits with the block's other hover tools, not over the notebook.
    const tools = screen.getByRole('group', { name: 'Block tools' });
    expect(within(tools).getByRole('button', { name: 'Hide code' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide code' }));
    expect(document.querySelector('.leaf-nb-code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
    expect(document.querySelector('.leaf-nb-code')).toBeTruthy();
  });

  it('a cell output collapses and opens again', async () => {
    const el = registries.blocks
      .resolve('ipynb')!
      .render(TEXT, '', { docPath: 'doc.md', config: {} }) as ReactElement;
    render(el);
    await screen.findByRole('heading', { name: 'Sales' });
    const toggle = screen.getAllByRole('button', { name: 'Collapse output' })[0]!;
    fireEvent.click(toggle);
    expect(screen.queryByText('6', { selector: 'pre' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand output' })[0]!);
    expect(screen.getByText('6', { selector: 'pre' })).toBeTruthy();
  });
});

describe('an HTML output whose frame answers at once', () => {
  // Like a live pane: the notebook loads lazily, so React attaches passive effects a
  // task after the output's frame is on the page, and a frame can report its height
  // inside that gap. The output must already be listening.
  it('takes the height its frame reports even before React has run its effects', async () => {
    const { default: NotebookView } = await import('../src/viewers/notebook/NotebookView.js');
    const { createRoot } = await import('react-dom/client');
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasAct = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    try {
      // The frame answers in the microtask after it is put on the page: after React's
      // commit, before any later task.
      const answered = new Promise<void>((resolve) => {
        const watch = new MutationObserver(() => {
          const f = host.querySelector('iframe.leaf-nb-html') as HTMLIFrameElement | null;
          if (!f) return;
          watch.disconnect();
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { leaf: 'nb-html', h: 300 },
              source: f.contentWindow as Window,
            }),
          );
          resolve();
        });
        watch.observe(host, { childList: true, subtree: true });
      });
      root.render(
        <NotebookView
          file={{
            type: 'file',
            path: 'doc.md#ipynb',
            kind: 'text',
            lang: 'ipynb',
            mime: 'text/plain',
            encoding: 'utf8',
            url: '',
            size: 1,
            mtime: 1,
          }}
          content={TEXT}
          docPath="doc.md"
          config={{}}
        />,
      );
      await answered;
      await new Promise((r) => setTimeout(r, 20));
      expect(host.querySelector<HTMLIFrameElement>('iframe.leaf-nb-html')!.style.height).toBe(
        '302px',
      );
    } finally {
      root.unmount();
      host.remove();
      g.IS_REACT_ACT_ENVIRONMENT = wasAct;
    }
  });
});
