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

  it('.three and .sketch files open as live panes of their kind, filling the view', async () => {
    const file = (path: string) => ({
      type: 'file' as const,
      path,
      kind: 'text',
      lang: 'javascript',
      mime: 'text/javascript',
      encoding: 'utf8' as const,
      url: '',
      size: 1,
      mtime: 1,
    });
    expect(viewers.forFile(file('knot.three')).id).toBe('live');
    expect(viewers.forFile(file('waves.sketch')).id).toBe('live');
    const live = viewers.forFile(file('knot.three'));
    render(
      <live.Rich file={file('knot.three')} content="scene;" docPath="knot.three" config={{}} />,
    );
    await screen.findByTitle('three animation');
    expect(pane().dataset.fill).toBe('');
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

  it('step pauses the pane and moves it one frame', () => {
    render(block(SINE));
    intersect(pane());
    watchFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Step' }));
    expect(sent).toContainEqual({ leaf: 'live', type: 'step' });
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('holding Step keeps stepping until let go', () => {
    vi.useFakeTimers();
    render(block(SINE));
    intersect(pane());
    watchFrame();
    const steps = () => sent.filter((m) => (m as { type: string }).type === 'step').length;
    const step = screen.getByRole('button', { name: 'Step' });
    fireEvent.pointerDown(step, { button: 0 });
    expect(steps()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerUp(step);
    fireEvent.click(step);
    const held = steps();
    expect(held).toBeGreaterThan(10);
    act(() => vi.advanceTimersByTime(500));
    expect(steps()).toBe(held);
    // A click from the keyboard is one step.
    fireEvent.click(step, { detail: 0 });
    expect(steps()).toBe(held + 1);
    vi.useRealTimers();
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

  it('a frame that navigates away is taken down, with a note why', () => {
    render(block(SINE));
    watchFrame();
    act(() => {
      frame().dispatchEvent(new Event('load'));
    });
    expect(document.querySelector('.leaf-live iframe')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/tried to leave its pane/);
    expect(pane().dataset.state).toBe('error');
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

describe('a pane that never starts', () => {
  it("says so instead of loading forever when its frame doesn't answer", () => {
    vi.useFakeTimers();
    try {
      render(block(SINE));
      watchFrame();
      expect(pane().dataset.state).toBe('loading');
      act(() => {
        vi.advanceTimersByTime(12_000);
      });
      expect(pane().dataset.state).toBe('error');
      expect(within(pane()).getByRole('alert').textContent).toMatch(/didn't start/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so too when its frame never even loads', () => {
    vi.useFakeTimers();
    try {
      render(block(SINE));
      expect(pane().dataset.state).toBe('loading');
      act(() => {
        vi.advanceTimersByTime(12_000);
      });
      expect(pane().dataset.state).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a three pane whose frame hangs after three.js arrives says so too', async () => {
    vi.useFakeTimers();
    try {
      render(block('scene.add(new THREE.Object3D());', '', 'three'));
      // three.js arrives, and the frame is made, but never loads or answers.
      await act(async () => {});
      expect(frame()).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(12_000);
      });
      expect(pane().dataset.state).toBe('error');
      expect(within(pane()).getByRole('alert').textContent).toMatch(/WebGL/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pane that answered in time is left alone', () => {
    vi.useFakeTimers();
    try {
      render(block(SINE));
      watchFrame();
      fromFrame({ leaf: 'live', type: 'ready' }, frame().contentWindow);
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(pane().dataset.state).not.toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a frame that answers at once', () => {
  // React attaches passive effects a task after it puts a pane on the page (always so
  // for a pane that loads lazily). Linux WebKit runs a srcdoc frame's script, and
  // delivers what it posts, inside that gap; the pane must already be listening.
  it('is heard even before React has run its effects', async () => {
    const { LivePane } = await import('../src/viewers/live/LivePane.js');
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
          const f = host.querySelector('iframe');
          if (!f) return;
          watch.disconnect();
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { leaf: 'live', type: 'ready' },
              source: f.contentWindow as Window,
            }),
          );
          resolve();
        });
        watch.observe(host, { childList: true, subtree: true });
      });
      root.render(
        <LivePane
          file={{
            type: 'file',
            path: 'doc.md#canvas',
            kind: 'text',
            lang: 'canvas',
            mime: 'text/plain',
            encoding: 'utf8',
            url: '',
            size: 1,
            mtime: 1,
          }}
          content={SINE}
          docPath="doc.md"
          config={{}}
        />,
      );
      await answered;
      await new Promise((r) => setTimeout(r, 20));
      expect(host.querySelector<HTMLElement>('.leaf-live')!.dataset.state).not.toBe('loading');
    } finally {
      root.unmount();
      host.remove();
      g.IS_REACT_ACT_ENVIRONMENT = wasAct;
    }
  });
});
