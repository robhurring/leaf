import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Stage } from '../src/stage/Stage.js';
import { useAnnotations } from '../src/store/annotations.js';
import { useStage } from '../src/store/stage.js';
import type { Viewer, ViewerProps } from '../src/viewers/types.js';

const Box = (p: ViewerProps) => <div>{p.content}</div>;
const viewer: Viewer = {
  id: 'box',
  matches: {},
  Inline: Box,
  Rich: Box,
  stage: { pan: true, zoom: true, draw: true },
};
const props: ViewerProps = {
  file: {
    type: 'file',
    path: 'a.md',
    kind: 'markdown',
    mime: 'text/markdown',
    encoding: 'utf8',
    url: '/raw/a.md',
    size: 1,
    mtime: 1,
  },
  content: 'hello',
  docPath: 'a.md',
  config: {},
};

function openStage() {
  act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
  return screen.getByTestId('stage-viewport');
}
function drawOne(target: Element) {
  fireEvent.pointerDown(target, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
  fireEvent.pointerMove(target, { clientX: 40, clientY: 30, pointerId: 1 });
  fireEvent.pointerMove(target, { clientX: 60, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(target, { pointerId: 1 });
}

beforeEach(() => {
  useAnnotations.setState({ strokes: [] });
  act(() =>
    useStage.setState({ open: null, tool: 'pencil', color: 'blue', brush: 'large', sticky: false }),
  );
});

describe('drawing on the Stage', () => {
  it('a pencil drag anywhere on the viewport adds a stroke in content coordinates with the chosen color and brush', () => {
    render(<Stage />);
    const viewport = openStage();
    fireEvent.click(screen.getByLabelText('Zoom in')); // scale 1.25 around the (0,0) center in happy-dom
    drawOne(viewport);
    const strokes = useAnnotations.getState().strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({
      docPath: 'a.md',
      blockHash: 'h1',
      color: 'blue',
      width: 8,
      sticky: false,
    });
    expect(strokes[0]!.points[0]).toEqual([16, 16]);
    expect(strokes[0]!.points.at(-1)).toEqual([48, 48]);
    const path = document.querySelector('path.leaf-ink')!;
    expect(path.getAttribute('d')).toMatch(/^M16 16/);
    expect(path.classList.contains('leaf-ink-fade')).toBe(true);
  });

  it('the hand tool pans instead of drawing', () => {
    act(() => useStage.setState({ tool: 'hand' }));
    render(<Stage />);
    drawOne(openStage());
    expect(useAnnotations.getState().strokes).toHaveLength(0);
    expect(screen.getByTestId('stage-layer').style.transform).toContain('translate(40px, 40px)');
  });

  it('sticky strokes do not fade and expired ink is removed on the timer', () => {
    vi.useFakeTimers();
    render(<Stage />);
    const viewport = openStage();
    act(() => useStage.setState({ sticky: true }));
    drawOne(viewport);
    act(() => useStage.setState({ sticky: false }));
    drawOne(viewport);
    expect(document.querySelectorAll('path.leaf-ink')).toHaveLength(2);
    expect(document.querySelectorAll('path.leaf-ink-fade')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(useAnnotations.getState().strokes).toHaveLength(1);
    expect(useAnnotations.getState().strokes[0]!.sticky).toBe(true);
    vi.useRealTimers();
  });

  it('stale sticky strokes are drawn dashed and Clear removes everything on this Stage', () => {
    useAnnotations.getState().add({
      id: 's',
      docPath: 'a.md',
      blockHash: 'h1',
      points: [
        [0, 0],
        [5, 5],
      ],
      color: 'red',
      width: 2,
      sticky: true,
      createdAt: 0,
      stale: true,
    });
    render(<Stage />);
    openStage();
    expect(document.querySelector('path.leaf-ink-stale')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Clear drawings'));
    expect(useAnnotations.getState().strokes).toHaveLength(0);
  });
});
