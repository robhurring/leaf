import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FileMessage } from '@leaf/protocol';
import { registries } from '../src/render/registries/index.js';
import { viewers } from '../src/viewers/index.js';
import { DocumentView } from '../src/components/DocumentView.js';
import { DocToolsContext } from '../src/components/Properties.js';
import { useAnnotations, type Stroke } from '../src/store/annotations.js';

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

const inks = () => document.querySelectorAll('.leaf-drawing path.leaf-ink');
const scribble = async (sheet: Element, x = 10) => {
  await act(async () => {
    fireEvent.pointerDown(sheet, { clientX: x, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(sheet, { clientX: x + 20, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(sheet, { clientX: x + 40, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(sheet, { pointerId: 1 });
  });
};

beforeEach(() => act(() => useAnnotations.setState({ strokes: [] })));

describe('drawing', () => {
  it('undo takes back the last stroke of that block only', () => {
    const { add, undo } = useAnnotations.getState();
    add(stroke('a', 'h1', 1));
    add(stroke('b', 'h2', 2));
    add(stroke('c', 'h1', 3));
    undo('a.md', 'h1');
    expect(useAnnotations.getState().strokes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('a ```draw block is a sheet to draw on, with undo, clear, and the picture tools', async () => {
    const el = registries.blocks
      .resolve('draw')!
      .render('', '', { docPath: 'doc.md', config: {} }) as ReactElement;
    render(el);
    const sheet = await waitFor(() => {
      const el = document.querySelector('.leaf-drawing');
      expect(el).toBeTruthy();
      return el!;
    });
    const tools = screen.getByRole('group', { name: 'Block tools' });
    await scribble(sheet);
    expect(inks()).toHaveLength(1);
    // Ink drawn here is kept, unless invisible ink is on.
    expect(inks()[0]!.getAttribute('class')).not.toContain('leaf-ink-fade');
    await scribble(sheet, 60);
    expect(inks()).toHaveLength(2);
    fireEvent.click(within(tools).getByRole('button', { name: 'Undo' }));
    expect(inks()).toHaveLength(1);
    fireEvent.click(within(tools).getByRole('button', { name: 'Clear drawing' }));
    expect(inks()).toHaveLength(0);
    fireEvent.click(within(tools).getByRole('button', { name: 'Invisible ink' }));
    await scribble(sheet);
    expect(inks()[0]!.getAttribute('class')).toContain('leaf-ink-fade');
    // The frame's own picture tools find the drawing.
    await waitFor(() => within(tools).getByRole('button', { name: 'Copy as image' }));
    within(tools).getByRole('button', { name: 'Download SVG' });
    within(tools).getByRole('button', { name: 'Green' });
  });

  it('a .draw file draws in the panel, with its tools, copy, and download in the file toolbar', async () => {
    const f: FileMessage = {
      type: 'file',
      path: 'notes/idea.draw',
      kind: 'text',
      mime: 'text/plain',
      encoding: 'utf8',
      content: '',
      url: '',
      size: 0,
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
    const sheet = await waitFor(() => {
      const el = document.querySelector('.leaf-drawing');
      expect(el).toBeTruthy();
      return el!;
    });
    await scribble(sheet);
    expect(inks()).toHaveLength(1);
    // Cmd-Z takes it back.
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(inks()).toHaveLength(0);
    for (const name of ['Undo', 'Clear drawing', 'Invisible ink', 'Copy as image', 'Download SVG'])
      within(slot).getByRole('button', { name });
  });
});
