import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';

const mocks = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }));
vi.mock('mermaid', () => ({ default: { initialize: mocks.initialize, render: mocks.render } }));

const { mermaid } = await import('../src/viewers/mermaid/index.js');
const { viewers } = await import('../src/viewers/index.js');

const file = (content: string): FileMessage => ({
  type: 'file',
  path: 'flow.mmd',
  kind: 'text',
  lang: 'mermaid',
  mime: 'text/plain',
  encoding: 'utf8',
  content,
  url: '/raw/flow.mmd',
  size: content.length,
  mtime: 1,
});
const props = { docPath: 'flow.mmd', config: {} };

beforeEach(() => {
  mocks.render
    .mockReset()
    .mockImplementation(async (_id: string, code: string) =>
      code.includes('bad')
        ? Promise.reject(new Error('Parse error on line 1'))
        : { svg: `<svg data-diagram="ok"><text>${code.length}</text></svg>` },
    );
});

describe('mermaid viewer', () => {
  it('draws labels as SVG text, not HTML, so the picture can be copied as an image', async () => {
    const { render } = await import('@testing-library/react');
    render(<mermaid.Inline file={file('graph TD; Q-->R')} content="graph TD; Q-->R" {...props} />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    const config = mocks.initialize.mock.calls.at(-1)![0];
    expect(config.htmlLabels).toBe(false);
    expect(config.flowchart.htmlLabels).toBe(false);
  });

  it('is picked for .mmd files and mermaid fences', () => {
    expect(viewers.forFile(file('graph TD')).id).toBe('mermaid');
    expect(viewers.forLang('mermaid')?.id).toBe('mermaid');
    expect(mermaid.stage).toMatchObject({ pan: true, zoom: true, draw: true });
  });

  it('renders the diagram svg and memoizes on content', async () => {
    const f = file('graph TD; A-->B');
    const { rerender, container } = render(
      <mermaid.Rich file={f} content={f.content} {...props} />,
    );
    await waitFor(() => expect(container.querySelector('svg[data-diagram="ok"]')).toBeTruthy());
    rerender(<mermaid.Rich file={f} content={f.content} {...props} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.render).toHaveBeenCalledTimes(1);
    rerender(
      <mermaid.Rich
        file={{ ...f, content: 'graph TD; A-->C' }}
        content="graph TD; A-->C"
        {...props}
      />,
    );
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
  });

  it('initializes mermaid with error rendering suppressed so failures leave no stray svg in the page', async () => {
    render(<mermaid.Rich file={file('graph TD; X-->Y')} content="graph TD; X-->Y" {...props} />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    expect(mocks.initialize.mock.calls[0]![0]).toMatchObject({
      suppressErrorRendering: true,
      securityLevel: 'strict',
    });
  });

  it('shows the parse error in place instead of a blank block', async () => {
    render(<mermaid.Rich file={file('bad graph')} content="bad graph" {...props} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Parse error on line 1/);
  });

  it('renders light when asked to, whatever the document appearance', async () => {
    document.documentElement.dataset.appearance = 'dark';
    try {
      const f = file('graph TD; L-->M');
      const { container } = render(
        <mermaid.Rich file={f} content={f.content} {...props} appearance="light" />,
      );
      await waitFor(() => expect(container.querySelector('svg[data-diagram="ok"]')).toBeTruthy());
      expect(mocks.initialize).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: 'default' }),
      );
    } finally {
      delete document.documentElement.dataset.appearance;
    }
  });
});
