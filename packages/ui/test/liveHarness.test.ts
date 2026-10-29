import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { harness } from '../src/viewers/live/harness.js';

// The harness runs in this test window as if it were the pane's frame: frames come
// from a hand-driven requestAnimationFrame, timers from vitest's fake clock, and what
// it posts to its parent is recorded.

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let posted: unknown[];
let now: number;
let listeners: [string, EventListenerOrEventListenerObject][];
const real = {
  raf: window.requestAnimationFrame,
  caf: window.cancelAnimationFrame,
  setTimeout: window.setTimeout,
  clearTimeout: window.clearTimeout,
  setInterval: window.setInterval,
  clearInterval: window.clearInterval,
};

/** Runs one animation frame, `ms` after the previous one. */
function frame(ms = 16) {
  now += ms;
  const due = [...frames.values()];
  frames.clear();
  for (const cb of due) cb(now);
}

function send(data: unknown, source: unknown = window.parent) {
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
}

function boot(code: string, extra: Record<string, unknown> = {}) {
  document.body.innerHTML = '';
  const el = document.createElement('script');
  el.type = 'application/json';
  el.id = 'leaf-boot';
  el.textContent = JSON.stringify({
    kind: 'canvas',
    code,
    theme: 'dark',
    paused: false,
    ...extra,
  });
  document.body.append(el);
}

async function run(code: string, extra: Record<string, unknown> = {}, h = harness) {
  boot(code, extra);
  h(window);
  await vi.advanceTimersByTimeAsync(0);
}

const errors = () =>
  posted.filter((m) => (m as { type: string }).type === 'error') as {
    message: string;
    line?: number;
  }[];

beforeEach(() => {
  vi.useFakeTimers();
  // Each test's harness listens on this one window; take its listeners away after.
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(
    (type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      listeners.push([type, fn]);
      add(type, fn, opts as AddEventListenerOptions);
    },
  );
  // The harness wraps these; give each test the fake clock's own.
  Object.assign(window, {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  frames = new Map();
  nextFrame = 0;
  now = 0;
  posted = [];
  window.requestAnimationFrame = (cb) => {
    frames.set(++nextFrame, cb);
    return nextFrame;
  };
  window.cancelAnimationFrame = (id) => void frames.delete(id);
  vi.spyOn(window.parent, 'postMessage').mockImplementation((m: unknown) => void posted.push(m));
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({ setTransform: vi.fn() }) as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [type, fn] of listeners) window.removeEventListener(type, fn);
  vi.useRealTimers();
  Object.assign(window, real);
});

describe('live pane harness', () => {
  it('says it is ready once the block has run', async () => {
    await run('onFrame(() => {});');
    expect(posted).toContainEqual({ leaf: 'live', type: 'ready' });
  });

  it('a canvas block gets a canvas, a context, and its size', async () => {
    await run('window.seen = [canvas.tagName, typeof ctx, width > 0, height > 0, theme];');
    expect((window as unknown as { seen: unknown[] }).seen).toEqual([
      'CANVAS',
      'object',
      true,
      true,
      'dark',
    ]);
  });

  it('an error names the line of the block it came from', async () => {
    await run('const a = 1;\nundefinedName();');
    expect(errors()).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/undefinedName/), line: 2 }),
    ]);
    expect(posted).not.toContainEqual({ leaf: 'live', type: 'ready' });
  });

  it('an error from outside the block, such as the library, names no line', async () => {
    await run("throw Object.assign(new Error('deep in three'), { stack: '', line: 900 });");
    expect(errors()).toEqual([expect.objectContaining({ message: expect.stringMatching(/deep/) })]);
    expect(errors()[0]!.line).toBeUndefined();
  });

  it('pause stops frames and time; play resumes where it left off', async () => {
    await run('window.ts = []; onFrame((t) => window.ts.push(t));');
    const ts = () => (window as unknown as { ts: number[] }).ts;
    frame();
    frame();
    frame();
    expect(ts()).toHaveLength(3);
    send({ leaf: 'live', type: 'pause' });
    frame(1000);
    frame(1000);
    expect(ts()).toHaveLength(3);
    send({ leaf: 'live', type: 'play' });
    frame(5000);
    frame();
    expect(ts()).toHaveLength(5);
    // No jump by the paused time: the last step is one frame.
    expect(ts()[4]! - ts()[3]!).toBe(16);
    expect(ts()[4]!).toBeLessThan(1000);
  });

  it('timers wait out a pause and keep the time they had left', async () => {
    await run('window.fired = 0; setTimeout(() => window.fired++, 100);');
    const fired = () => (window as unknown as { fired: number }).fired;
    await vi.advanceTimersByTimeAsync(50);
    send({ leaf: 'live', type: 'pause' });
    await vi.advanceTimersByTimeAsync(200);
    expect(fired()).toBe(0);
    send({ leaf: 'live', type: 'play' });
    await vi.advanceTimersByTimeAsync(40);
    expect(fired()).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(fired()).toBe(1);
  });

  it('intervals pause too, and clear', async () => {
    await run('window.n = 0; window.iv = setInterval(() => window.n++, 10);');
    const n = () => (window as unknown as { n: number }).n;
    await vi.advanceTimersByTimeAsync(35);
    expect(n()).toBe(3);
    send({ leaf: 'live', type: 'pause' });
    await vi.advanceTimersByTimeAsync(100);
    expect(n()).toBe(3);
    send({ leaf: 'live', type: 'play' });
    await vi.advanceTimersByTimeAsync(10);
    expect(n()).toBe(4);
    clearInterval((window as unknown as { iv: number }).iv);
    await vi.advanceTimersByTimeAsync(100);
    expect(n()).toBe(4);
  });

  it('a frame callback that throws reports once and stops the loop', async () => {
    await run('window.calls = 0; onFrame(() => { window.calls++; throw new Error("boom"); });');
    frame();
    frame();
    frame();
    expect(errors()).toHaveLength(1);
    expect(errors()[0]!.message).toMatch(/boom/);
    expect((window as unknown as { calls: number }).calls).toBe(1);
  });

  it('ignores messages from anything but its parent', async () => {
    await run('window.count = 0; onFrame(() => window.count++);');
    send({ leaf: 'live', type: 'pause' }, {});
    send({ type: 'pause' });
    frame();
    expect((window as unknown as { count: number }).count).toBe(1);
  });

  it('a theme message sets the theme and fires themechange once', async () => {
    await run('window.changes = 0; addEventListener("themechange", () => window.changes++);');
    send({ leaf: 'live', type: 'theme', theme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect((window as unknown as { changes: number }).changes).toBe(1);
    expect((window as unknown as { theme: string }).theme).toBe('light');
  });

  it('starting paused draws one frame, then waits for play', async () => {
    await run('window.count = 0; onFrame(() => window.count++);', { paused: true });
    frame();
    frame();
    frame();
    expect((window as unknown as { count: number }).count).toBe(1);
    send({ leaf: 'live', type: 'play' });
    frame();
    expect((window as unknown as { count: number }).count).toBe(2);
  });

  it('a play that arrives before the first frame keeps it running', async () => {
    await run('window.count = 0; onFrame(() => window.count++);', { paused: true });
    send({ leaf: 'live', type: 'play' });
    frame();
    frame();
    frame();
    expect((window as unknown as { count: number }).count).toBe(3);
  });

  it('still works after being turned into source text, as the frame receives it', async () => {
    const copy = new Function(`return ${harness.toString()}`)() as typeof harness;
    await run('onFrame(() => {});', {}, copy);
    expect(posted).toContainEqual({ leaf: 'live', type: 'ready' });
  });
});
