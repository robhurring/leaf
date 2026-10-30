import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Stage } from '../src/stage/Stage.js';
import { useStage } from '../src/store/stage.js';
import { useAnnotations } from '../src/store/annotations.js';
import type { Viewer, ViewerProps } from '../src/viewers/types.js';

const Box = (p: ViewerProps) => (
  <div data-testid="content" data-appearance={p.appearance}>
    {p.content}
  </div>
);
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

beforeEach(() => act(() => useStage.getState().close()));

describe('Stage', () => {
  it('a picture stays centered when the window is resized', () => {
    const observers: { cb: () => void; el?: Element }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(public cb: () => void) {
          observers.push(this as never);
        }
        observe(el: Element) {
          (this as unknown as { el: Element }).el = el;
        }
        disconnect() {}
      },
    );
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    const view = screen.getByTestId('stage-viewport');
    const layer = screen.getByTestId('stage-layer');
    const size = (w: number, h: number) => {
      Object.defineProperty(view, 'clientWidth', { value: w, configurable: true });
      Object.defineProperty(view, 'clientHeight', { value: h, configurable: true });
      act(() => observers.filter((o) => o.el === view).forEach((o) => o.cb()));
    };
    size(800, 600);
    const before = layer.style.transform;
    size(1000, 700);
    const at = (t: string) =>
      /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(t)!.slice(1).map(Number);
    const [x0, y0] = at(before);
    const [x1, y1] = at(layer.style.transform);
    expect([x1 - x0, y1 - y0]).toEqual([100, 50]);
    vi.unstubAllGlobals();
  });

  it('a viewer that does not zoom fills the Stage at its own size, with no zoom tools', () => {
    render(<Stage />);
    const live: Viewer = { ...viewer, id: 'live', stage: {} };
    act(() =>
      useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer: live, props }),
    );
    const content = screen.getByTestId('content');
    expect(content.closest('.leaf-stage-layer')).toBeNull();
    expect(content.closest('.leaf-stage-fill')).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Stage tools' })).toBeNull();
  });

  it('renders nothing until opened, then shows the viewer, toolbox, and closes on Escape', () => {
    render(<Stage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    expect(screen.getByRole('dialog', { name: 'Zoomed view' })).toBeTruthy();
    expect(screen.getByTestId('content').textContent).toBe('hello');
    // The canvas is white, so the viewer is asked for its light rendering.
    expect(screen.getByTestId('content').dataset.appearance).toBe('light');
    const toolbox = screen.getByRole('toolbar', { name: 'Stage tools' });
    for (const name of [
      'Hand',
      'Pencil',
      'Zoom in',
      'Zoom out',
      'Fit',
      'Actual size',
      'Sticky ink',
      'Undo',
      'Clear drawings',
    ]) {
      expect(toolbox.querySelector(`[aria-label="${name}"]`), name).toBeTruthy();
    }
    // Sticky and clear are icon buttons, not text.
    expect(toolbox.querySelector('[aria-label="Sticky ink"] svg')).toBeTruthy();
    expect(toolbox.querySelector('[aria-label="Clear drawings"] svg')).toBeTruthy();
    expect(toolbox.querySelector('[aria-label="Close"]')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('zoom buttons change the content transform and wheel zoom is captured', () => {
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    const layer = screen.getByTestId('stage-layer');
    expect(layer.style.transform).toContain('scale(1)');
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(layer.style.transform).not.toContain('scale(1)');
    fireEvent.click(screen.getByLabelText('Actual size'));
    expect(layer.style.transform).toContain('scale(1)');
    const viewport = screen.getByTestId('stage-viewport');
    const ev = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'ctrlKey', { value: true }); // happy-dom drops it from the init
    act(() => {
      viewport.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(layer.style.transform).not.toContain('scale(1)');
  });

  it('hand drag pans, pencil tool switches, color and brush select', () => {
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    const viewport = screen.getByTestId('stage-viewport');
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 40, clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(screen.getByTestId('stage-layer').style.transform).toContain('translate(30px, 15px)');
    fireEvent.click(screen.getByLabelText('Pencil'));
    expect(useStage.getState().tool).toBe('pencil');
    fireEvent.click(screen.getByLabelText('Green'));
    fireEvent.click(screen.getByLabelText('Large brush'));
    expect(useStage.getState()).toMatchObject({ color: 'green', brush: 'large' });
  });

  it('has a title bar naming the block whose close button closes the Stage', () => {
    render(<Stage />);
    act(() =>
      useStage.getState().openStage({ docPath: 'docs/a.md', blockHash: 'h1', viewer, props }),
    );
    const title = screen.getByTestId('stage-title');
    expect(title.textContent).toContain('box');
    expect(title.textContent).toContain('docs/a.md');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('1 and 2 pick the hand and pencil; space holds the hand while pressed', () => {
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    fireEvent.keyDown(window, { key: '2' });
    expect(useStage.getState().tool).toBe('pencil');
    fireEvent.keyDown(window, { key: ' ' });
    expect(useStage.getState().tool).toBe('hand');
    fireEvent.keyDown(window, { key: ' ', repeat: true });
    fireEvent.keyUp(window, { key: ' ' });
    expect(useStage.getState().tool).toBe('pencil');
    fireEvent.keyDown(window, { key: '1' });
    expect(useStage.getState().tool).toBe('hand');
    fireEvent.keyUp(window, { key: ' ' });
    expect(useStage.getState().tool).toBe('hand');
  });

  it('Undo and Cmd-Z take back the last stroke', () => {
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    act(() => useStage.getState().setTool('pencil'));
    const viewport = screen.getByTestId('stage-viewport');
    const stroke = () => {
      fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
      fireEvent.pointerMove(viewport, { clientX: 40, clientY: 25, pointerId: 1 });
      fireEvent.pointerUp(viewport, { pointerId: 1 });
    };
    stroke();
    stroke();
    const count = () => useAnnotations.getState().strokes.length;
    expect(count()).toBe(2);
    fireEvent.click(screen.getByLabelText('Undo'));
    expect(count()).toBe(1);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(count()).toBe(0);
  });

  it('a pencil stroke starts without a text selection: pointer down is default-prevented', () => {
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    act(() => useStage.getState().setTool('pencil'));
    const viewport = screen.getByTestId('stage-viewport');
    const ev = new PointerEvent('pointerdown', {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    } as PointerEventInit);
    act(() => {
      viewport.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(getComputedStyle(viewport).userSelect || 'none').toBe('none');
  });

  it('two-finger scroll pans; a mouse wheel zooms', () => {
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    const layer = screen.getByTestId('stage-layer');
    const viewport = screen.getByTestId('stage-viewport');
    act(() => {
      viewport.dispatchEvent(
        new WheelEvent('wheel', { deltaX: -10, deltaY: 4, bubbles: true, cancelable: true }),
      );
    });
    expect(layer.style.transform).toBe('translate(10px, -4px) scale(1)');
    act(() => {
      viewport.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true }),
      );
    });
    expect(layer.style.transform).not.toContain('scale(1)');
  });

  it('a WebKit pinch (gesturechange) zooms and does not zoom the page', () => {
    render(<Stage />);
    act(() => useStage.getState().openStage({ docPath: 'a.md', blockHash: 'h1', viewer, props }));
    const layer = screen.getByTestId('stage-layer');
    const viewport = screen.getByTestId('stage-viewport');
    const gesture = (type: string, scale: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, { scale, clientX: 0, clientY: 0 });
      act(() => {
        viewport.dispatchEvent(ev);
      });
      return ev;
    };
    gesture('gesturestart', 1);
    const ev = gesture('gesturechange', 1.5);
    gesture('gestureend', 1.5);
    expect(ev.defaultPrevented).toBe(true);
    expect(layer.style.transform).toContain('scale(1.5)');
  });
});
