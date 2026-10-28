import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';

vi.mock('@excalidraw/excalidraw', () => ({
  exportToSvg: vi.fn(async (opts: { elements: unknown[] }) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('data-elements', String(opts.elements.length));
    return el;
  }),
}));

const { excalidraw } = await import('../src/viewers/excalidraw/index.js');
const { viewers } = await import('../src/viewers/index.js');

const scene = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [
    { type: 'rectangle', id: 'r1' },
    { type: 'text', id: 't1' },
  ],
  appState: {},
});
const file = (content: string): FileMessage => ({
  type: 'file',
  path: 'sketch.excalidraw',
  kind: 'text',
  lang: 'json',
  mime: 'text/plain',
  encoding: 'utf8',
  content,
  url: '/raw/sketch.excalidraw',
  size: content.length,
  mtime: 1,
});
const props = { docPath: 'sketch.excalidraw', config: {} };

describe('excalidraw viewer', () => {
  it('is picked for .excalidraw files and excalidraw fences', () => {
    expect(viewers.forFile(file(scene)).id).toBe('excalidraw');
    expect(viewers.forLang('excalidraw')?.id).toBe('excalidraw');
  });
  it('renders the exported svg', async () => {
    const { container } = render(<excalidraw.Rich file={file(scene)} content={scene} {...props} />);
    await waitFor(() => expect(container.querySelector('svg[data-elements="2"]')).toBeTruthy());
  });
  it('reports invalid scenes in place', async () => {
    render(<excalidraw.Rich file={file('{not json')} content="{not json" {...props} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/not valid/i);
  });
});
