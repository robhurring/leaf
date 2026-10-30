import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlockFrame } from '../src/components/BlockFrame.js';
import { useStage } from '../src/store/stage.js';
import { mermaid } from '../src/viewers/mermaid/index.js';
import { code } from '../src/viewers/code/index.js';
import type { FileMessage } from '@leaf/protocol';
import { plantuml } from '../src/viewers/plantuml/index.js';

const imageMocks = vi.hoisted(() => ({
  copyImage: vi.fn(async () => {}),
  copyRaster: vi.fn(async () => {}),
  copyCanvas: vi.fn(async () => {}),
  copyFrame: vi.fn(async () => {}),
  downloadText: vi.fn(),
}));
vi.mock('../src/stage/image.js', async (orig) => ({
  ...(await orig<typeof import('../src/stage/image.js')>()),
  ...imageMocks,
}));

const file: FileMessage = {
  type: 'file',
  path: 'a.md',
  kind: 'markdown',
  mime: 'text/markdown',
  encoding: 'utf8',
  url: '/raw/a.md',
  size: 1,
  mtime: 1,
};
const props = { file, content: 'graph TD; A-->B', docPath: 'a.md', config: {} };

beforeEach(() => {
  act(() => useStage.getState().close());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}), write: vi.fn(async () => {}) },
    configurable: true,
  });
});

describe('BlockFrame', () => {
  it('copy as image and download act on the diagram, never on a toolbar icon', () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <div className="leaf-diagram">
          <svg data-testid="diagram" viewBox="0 0 10 10" />
        </div>
      </BlockFrame>,
    );
    fireEvent.click(screen.getByLabelText('Copy as image'));
    expect(imageMocks.copyImage).toHaveBeenCalledTimes(1);
    expect(
      (imageMocks.copyImage.mock.calls[0] as unknown as [Element])[0].getAttribute('data-testid'),
    ).toBe('diagram');
    fireEvent.click(screen.getByLabelText('Download SVG'));
    expect(imageMocks.downloadText).toHaveBeenCalledTimes(1);
    expect((imageMocks.downloadText.mock.calls[0] as unknown as [string])[0]).toContain(
      'viewBox="0 0 10 10"',
    );
  });

  it('an <img> based viewer offers copy as image through the raster path and no SVG download', () => {
    render(
      <BlockFrame
        viewer={plantuml}
        props={{
          ...props,
          content: '@startuml\n@enduml',
          config: { plantumlUrl: 'https://p.example' },
        }}
        lang="plantuml"
      >
        <div className="leaf-diagram">
          <img className="leaf-plantuml" src="https://p.example/svg/x" alt="" />
        </div>
      </BlockFrame>,
    );
    const tools = screen.getByRole('group', { name: 'Block tools' });
    expect(tools.querySelector('[aria-label="Download SVG"]')).toBeNull();
    fireEvent.click(screen.getByLabelText('Copy as image'));
    expect(imageMocks.copyRaster).toHaveBeenCalledTimes(1);
  });

  it('copy as image failure shows a red x', async () => {
    imageMocks.copyImage.mockRejectedValueOnce(new Error('tainted'));
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <div className="leaf-diagram">
          <svg />
        </div>
      </BlockFrame>,
    );
    fireEvent.click(screen.getByLabelText('Copy as image'));
    const note = await screen.findByRole('status');
    expect(note.getAttribute('data-result')).toBe('failed');
    expect(note.querySelector('svg')).toBeTruthy();
  });

  it('offers zoom, pan, the zoomed view, copy source, copy as image, and download for a visual viewer', () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <div className="leaf-diagram">
          <svg data-testid="svg" width="10" height="10" />
        </div>
      </BlockFrame>,
    );
    const tools = screen.getByRole('group', { name: 'Block tools' });
    for (const name of [
      'Zoom in',
      'Zoom out',
      'Reset zoom',
      'Pan',
      'Open zoomed view',
      'Copy source',
      'Copy as image',
      'Download SVG',
    ])
      expect(tools.querySelector(`[aria-label="${name}"]`), name).toBeTruthy();
  });

  it('a viewer that does not zoom offers the zoomed view but no zoom or pan in place', () => {
    const still = { ...mermaid, id: 'still', stage: {} };
    render(
      <BlockFrame viewer={still} props={props} lang="still">
        <div />
      </BlockFrame>,
    );
    const tools = screen.getByRole('group', { name: 'Block tools' });
    expect(tools.querySelector('[aria-label="Open zoomed view"]')).toBeTruthy();
    expect(tools.querySelector('[aria-label="Zoom in"]')).toBeNull();
    expect(tools.querySelector('[aria-label="Pan"]')).toBeNull();
  });

  it('a visual block flips to its source and back', async () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <div className="leaf-diagram" data-testid="picture" />
      </BlockFrame>,
    );
    const toggle = screen.getByRole('button', { name: 'Show source' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('picture')).toBeNull();
    // Highlighting splits the text into spans, so read the whole source view.
    await waitFor(() =>
      expect(document.querySelector('.leaf-block-source')?.textContent).toContain('graph TD'),
    );
    // No zooming a page of text.
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }));
    expect(screen.getByTestId('picture')).toBeTruthy();
  });

  it('a chart or a live pane copies as an image too', async () => {
    const chartViewer = { ...mermaid, id: 'chart', stage: {} };
    const { unmount } = render(
      <BlockFrame viewer={chartViewer} props={props} lang="chart">
        <div className="leaf-chart">
          <canvas data-testid="canvas" />
        </div>
      </BlockFrame>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Copy as image' }));
    await waitFor(() =>
      expect(imageMocks.copyCanvas).toHaveBeenCalledWith(screen.getByTestId('canvas')),
    );
    unmount();
    const liveViewer = { ...mermaid, id: 'live', stage: {} };
    render(
      <BlockFrame viewer={liveViewer} props={props} lang="canvas">
        <div className="leaf-live">
          <iframe title="canvas animation" data-testid="frame" />
        </div>
      </BlockFrame>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Copy as image' }));
    await waitFor(() =>
      expect(imageMocks.copyFrame).toHaveBeenCalledWith(screen.getByTestId('frame')),
    );
  });

  it('a pinch zooms a diagram in place; a scroll is left to the page', () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <div className="leaf-diagram">
          <svg width="10" height="10" />
        </div>
      </BlockFrame>,
    );
    const view = document.querySelector('.leaf-block-view') as HTMLElement;
    const scroll = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    act(() => {
      view.dispatchEvent(scroll);
    });
    expect(scroll.defaultPrevented).toBe(false);
    expect(view.style.transform).toBe('');
    const pinch = new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true });
    // How a trackpad reports a pinch (happy-dom drops ctrlKey from the init).
    Object.defineProperty(pinch, 'ctrlKey', { value: true });
    act(() => {
      view.dispatchEvent(pinch);
    });
    expect(pinch.defaultPrevented).toBe(true);
    expect(view.style.transform).toMatch(/scale\(1\.[0-9]+\)/);
    // Zoomed in, a drag pans without choosing the hand first.
    fireEvent.pointerDown(view, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(view, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(view, { pointerId: 1 });
    expect(view.style.transform).toMatch(/translate\(.*30.*px, .*20.*px\)/);
    fireEvent.doubleClick(view);
    expect(view.style.transform).toBe('');
  });

  it('a code block offers only copy', () => {
    render(
      <BlockFrame viewer={code} props={{ ...props, content: 'x' }} lang="typescript">
        <pre>x</pre>
      </BlockFrame>,
    );
    const tools = screen.getByRole('group', { name: 'Block tools' });
    expect(tools.querySelectorAll('button')).toHaveLength(1);
    expect(tools.querySelector('[aria-label="Copy source"]')).toBeTruthy();
  });

  it('zoom in and out scale the diagram in place; reset puts it back', () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <svg />
      </BlockFrame>,
    );
    const view = document.querySelector<HTMLElement>('.leaf-block-view')!;
    expect(view.style.transform).toBe('');
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(view.style.transform).toContain('scale(1.25)');
    fireEvent.click(screen.getByLabelText('Zoom out'));
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(view.style.transform).toContain('scale(0.8)');
    fireEvent.click(screen.getByLabelText('Reset zoom'));
    expect(view.style.transform).toBe('');
    expect(useStage.getState().open).toBeNull();
  });

  it('pan mode drags the diagram; without it a drag does nothing', () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <svg />
      </BlockFrame>,
    );
    const view = document.querySelector<HTMLElement>('.leaf-block-view')!;
    const drag = () => {
      fireEvent.pointerDown(view, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.pointerMove(view, { clientX: 40, clientY: 30 });
      fireEvent.pointerUp(view, { clientX: 40, clientY: 30 });
    };
    drag();
    expect(view.style.transform).toBe('');
    fireEvent.click(screen.getByLabelText('Pan'));
    expect(screen.getByLabelText('Pan').getAttribute('aria-pressed')).toBe('true');
    drag();
    expect(view.style.transform).toContain('translate(30px, 20px)');
  });

  it('open zoomed view opens the Stage with the viewer and its props', () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <svg />
      </BlockFrame>,
    );
    fireEvent.click(screen.getByLabelText('Open zoomed view'));
    const open = useStage.getState().open!;
    expect(open.viewer.id).toBe('mermaid');
    expect(open.props.content).toBe('graph TD; A-->B');
    expect(open.docPath).toBe('a.md');
    expect(open.blockHash).toMatch(/^[0-9a-z]+$/);
  });

  it('copy source writes the block source; a check on success, an x on failure', async () => {
    render(
      <BlockFrame viewer={mermaid} props={props} lang="mermaid">
        <svg />
      </BlockFrame>,
    );
    fireEvent.click(screen.getByLabelText('Copy source'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('graph TD; A-->B');
    const ok = await screen.findByRole('status');
    expect(ok.getAttribute('data-result')).toBe('ok');
    expect(ok.querySelector('svg')).toBeTruthy();
    expect(ok.textContent).toBe('');
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('denied'),
    );
    fireEvent.click(screen.getByLabelText('Copy source'));
    await vi.waitFor(() =>
      expect(screen.getByRole('status').getAttribute('data-result')).toBe('failed'),
    );
  });
});
