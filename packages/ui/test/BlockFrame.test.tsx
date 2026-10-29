import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BlockFrame } from '../src/components/BlockFrame.js';
import { useStage } from '../src/store/stage.js';
import { mermaid } from '../src/viewers/mermaid/index.js';
import { code } from '../src/viewers/code/index.js';
import type { FileMessage } from '@leaf/protocol';
import { plantuml } from '../src/viewers/plantuml/index.js';

const imageMocks = vi.hoisted(() => ({
  copyImage: vi.fn(async () => {}),
  copyRaster: vi.fn(async () => {}),
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
