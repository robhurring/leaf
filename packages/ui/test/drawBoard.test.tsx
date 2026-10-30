import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FileMessage } from '@leaf/protocol';
import { registries } from '../src/render/registries/index.js';
import { viewers } from '../src/viewers/index.js';
import { DocumentView } from '../src/components/DocumentView.js';
import { DocToolsContext } from '../src/components/Properties.js';
import { useAnnotations, type Stroke } from '../src/store/annotations.js';
import { useStage } from '../src/store/stage.js';
import { composeSvg } from '../src/stage/image.js';

const stroke = (id: string, blockHash: string, createdAt: number): Stroke => ({
  id,
  docPath: 'a.md',
  blockHash,
  points: [
    [0, 0],
    [1, 1],
  ],
  color: 'red',
  width: 2,
  sticky: true,
  createdAt,
});

const TOOLS = [
  'Hand',
  'Pencil',
  'Zoom in',
  'Fit',
  'Green',
  'Large brush',
  'Sticky ink',
  'Undo',
  'Clear drawings',
  'Copy as image',
  'Download SVG',
];
const count = () => useAnnotations.getState().strokes.length;
const scribble = (viewport: Element) => {
  fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  fireEvent.pointerMove(viewport, { clientX: 40, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(viewport, { pointerId: 1 });
};

beforeEach(() =>
  act(() => {
    useAnnotations.setState({ strokes: [] });
    useStage.setState({ tool: 'hand', sticky: false });
  }),
);

describe('drawing', () => {
  it('undo takes back the last stroke of that block only', () => {
    const { add, undo } = useAnnotations.getState();
    add(stroke('a', 'h1', 1));
    add(stroke('b', 'h2', 2));
    add(stroke('c', 'h1', 3));
    undo('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('a picture and its ink come out as one svg, the ink in content coordinates on top', () => {
    const svg = composeSvg(
      { w: 400, h: 300 },
      {
        markup: '<svg viewBox="0 0 10 10"><circle r="5"/></svg>',
        x: 20,
        y: 10,
        width: 200,
        height: 100,
      },
      [
        {
          ...stroke('a', 'h', 1),
          color: 'green',
          points: [
            [5, 6],
            [50, 60],
          ],
        },
      ],
    );
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 400 300');
    const inner = root.querySelector('svg')!;
    expect([inner.getAttribute('x'), inner.getAttribute('width')]).toEqual(['20', '200']);
    expect(inner.querySelector('circle')).toBeTruthy();
    const ink = root.querySelector(':scope > path')!;
    expect(ink.getAttribute('d')).toBe('M5 6 L50 60');
    expect(ink.getAttribute('stroke')).toBe('#30a46c');
  });

  it('a ```draw block has the Stage tools, opens with the pencil, and no source view', async () => {
    const el = registries.blocks
      .resolve('draw')!
      .render('', '', { docPath: 'doc.md', config: {} }) as ReactElement;
    render(el);
    const toolbox = await screen.findByRole('toolbar', { name: 'Stage tools' });
    for (const name of TOOLS) within(toolbox).getByRole('button', { name });
    // A sheet in a document leaves the tools alone until the pointer comes onto it,
    // and gives them back when it leaves.
    expect(useStage.getState()).toMatchObject({ tool: 'hand', sticky: false });
    fireEvent.pointerEnter(screen.getByTestId('stage-viewport'));
    expect(useStage.getState()).toMatchObject({ tool: 'pencil', sticky: true });
    const blockTools = screen.getByRole('group', { name: 'Block tools' });
    expect(within(blockTools).queryByRole('button', { name: 'Show source' })).toBeNull();
    scribble(screen.getByTestId('stage-viewport'));
    scribble(screen.getByTestId('stage-viewport'));
    expect(count()).toBe(2);
    fireEvent.click(within(toolbox).getByRole('button', { name: 'Undo' }));
    expect(count()).toBe(1);
    fireEvent.pointerLeave(screen.getByTestId('stage-viewport'));
    expect(useStage.getState()).toMatchObject({ tool: 'hand', sticky: false });
  });

  it('a .draw file has the Stage tools in the file toolbar and no source view', async () => {
    const f: FileMessage = {
      type: 'file',
      path: 'notes/idea.draw',
      kind: 'text',
      mime: 'text/plain',
      encoding: 'utf8',
      content: 'size: 600x400\n',
      url: '',
      size: 14,
      mtime: 1,
    };
    expect(viewers.forFile(f)?.id).toBe('draw');
    const slot = document.createElement('div');
    document.body.append(slot);
    render(
      <DocToolsContext.Provider value={slot}>
        <DocumentView
          file={f}
          path={f.path}
          config={{}}
          numbering={false}
          linkBase=""
          onNavigate={() => {}}
        />
      </DocToolsContext.Provider>,
    );
    await waitFor(() => within(slot).getByRole('toolbar', { name: 'Stage tools' }));
    for (const name of TOOLS) within(slot).getByRole('button', { name });
    expect(within(slot).queryByRole('button', { name: 'Show source' })).toBeNull();
    scribble(screen.getByTestId('stage-viewport'));
    expect(count()).toBe(1);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(count()).toBe(0);
  });
});
