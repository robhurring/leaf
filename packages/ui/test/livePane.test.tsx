import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('../src/viewers/live/libs.js', () => ({
  loadThreeLibs: vi.fn(async () => ({ three: 'window.THREE = {};' })),
}));

const { viewers } = await import('../src/viewers/index.js');
const { registries } = await import('../src/render/registries/index.js');
const { useStage } = await import('../src/store/stage.js');
const { contentHash } = await import('../src/viewers/hash.js');

const intersect = (
  globalThis as unknown as {
    intersect: (el: Element, isIntersecting?: boolean) => void;
  }
).intersect;
const ctx = { docPath: 'doc.md', config: {} };
const SINE = 'onFrame((t) => ctx.fillRect(0, 0, t % 10, 1));';

const block = (code: string, meta = '', lang = 'canvas') =>
  registries.blocks.resolve(lang)!.render(code, meta, ctx) as ReactElement;

const pane = () => document.querySelector<HTMLElement>('.leaf-live')!;
const frame = () => document.querySelector<HTMLIFrameElement>('.leaf-live iframe')!;

/** A message as if from `source`, as the pane sees it. */
function fromFrame(data: unknown, source: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
  });
}

let sent: unknown[];
function watchFrame() {
  sent = [];
  vi.spyOn(frame().contentWindow!, 'postMessage').mockImplementation(
    (m: unknown) => void sent.push(m),
  );
  act(() => {
    frame().dispatchEvent(new Event('load'));
  });
}
const types = () => sent.map((m) => (m as { type: string }).type);

let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({
      matches: q.includes('reduced-motion') && reduced,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  act(() => useStage.getState().close());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live animation blocks', () => {
  it('three and canvas fences become live panes; js stays code', () => {
    expect(viewers.forLang('three')?.id).toBe('live');
    expect(viewers.forLang('canvas')?.id).toBe('live');
    expect(viewers.forLang('js')?.id).not.toBe('live');
    expect(viewers.forLang('javascript')?.id).not.toBe('live');
  });

  it('runs in a frame sealed off from leaf, sized by the fence', () => {
    render(block(SINE, 'height=480'));
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame().style.height).toBe('480px');
    expect(frame().getAttribute('srcdoc')).toContain('ctx.fillRect');
    expect(frame().getAttribute('title')).toBe('canvas animation');
  });

  it('a three block waits for three.js, then carries it in the frame', async () => {
    render(block('scene.add(new THREE.Object3D());', '', 'three'));
    await screen.findByTitle('three animation');
    expect(frame().getAttribute('srcdoc')).toContain('window.THREE = {};');
  });

  it("shows an error from its own frame, with the line; ignores anyone else's", () => {
    render(block(SINE));
    fromFrame({ leaf: 'live', type: 'error', message: 'boom', line: 3 }, window);
    expect(screen.queryByRole('alert')).toBeNull();
    fromFrame({ leaf: 'live', type: 'error', message: 'boom', line: 3 }, frame().contentWindow);
    expect(screen.getByRole('alert').textContent).toContain('line 3: boom');
    expect(pane().dataset.state).toBe('error');
  });

  it('ready from the frame makes it running', () => {
    render(block(SINE));
    intersect(pane());
    expect(pane().dataset.state).toBe('loading');
    fromFrame({ leaf: 'live', type: 'ready' }, frame().contentWindow);
    expect(pane().dataset.state).toBe('running');
  });

  it('pause and play are sent to the frame', () => {
    render(block(SINE));
    intersect(pane());
    watchFrame();
    expect(types()).toContain('play');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(sent.at(-1)).toEqual({ leaf: 'live', type: 'pause' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(sent.at(-1)).toEqual({ leaf: 'live', type: 'play' });
  });

  it('pauses off screen and while the window is hidden', () => {
    render(block(SINE));
    intersect(pane());
    watchFrame();
    act(() => intersect(pane(), false));
    expect(sent.at(-1)).toEqual({ leaf: 'live', type: 'pause' });
    act(() => intersect(pane(), true));
    expect(sent.at(-1)).toEqual({ leaf: 'live', type: 'play' });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(sent.at(-1)).toEqual({ leaf: 'live', type: 'pause' });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(sent.at(-1)).toEqual({ leaf: 'live', type: 'play' });
  });

  it('keeps running through edits elsewhere; restarts when its own code changes', () => {
    const { rerender } = render(block(SINE));
    const first = frame();
    const doc = first.getAttribute('srcdoc');
    rerender(block(SINE));
    expect(frame()).toBe(first);
    expect(frame().getAttribute('srcdoc')).toBe(doc);
    rerender(block(SINE + '\n// changed'));
    expect(frame().getAttribute('srcdoc')).toContain('// changed');
  });

  it('restart starts the frame over and clears the error', () => {
    render(block(SINE));
    const first = frame();
    fromFrame({ leaf: 'live', type: 'error', message: 'boom' }, first.contentWindow);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(frame()).not.toBe(first);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('view code shows the source instead of the frame', () => {
    render(block(SINE));
    fireEvent.click(screen.getByRole('button', { name: 'View code' }));
    expect(document.querySelector('.leaf-live iframe')).toBeNull();
    expect(document.querySelector('.leaf-live pre')!.textContent).toBe(SINE);
    fireEvent.click(screen.getByRole('button', { name: 'View code' }));
    expect(frame()).toBeTruthy();
  });

  it('pauses while the same block is open in the Stage', () => {
    render(block(SINE));
    intersect(pane());
    watchFrame();
    const viewer = viewers.forLang('canvas')!;
    act(() =>
      useStage.getState().openStage({
        docPath: 'doc.md',
        blockHash: contentHash(SINE),
        viewer,
        props: { file: {} as never, content: SINE, docPath: 'doc.md', config: {} },
        lang: 'canvas',
      }),
    );
    expect(sent.at(-1)).toEqual({ leaf: 'live', type: 'pause' });
  });

  it('with reduced motion it starts paused, showing its first frame', () => {
    reduced = true;
    render(block(SINE));
    const controls = screen.getByRole('group', { name: 'Animation' });
    expect(within(controls).getAllByRole('button')[0]!.getAttribute('aria-label')).toBe('Play');
    expect(frame().getAttribute('srcdoc')).toContain('"paused":true');
  });

  it('a theme change is sent to the frame, not rebuilt', () => {
    render(block(SINE));
    watchFrame();
    const doc = frame().getAttribute('srcdoc');
    act(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    // The pane follows leaf's appearance; it tells the frame and keeps its document.
    expect(frame().getAttribute('srcdoc')).toBe(doc);
  });
});
