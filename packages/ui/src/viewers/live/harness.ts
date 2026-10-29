// Runs inside a live pane's frame. It is written into the frame as source text
// (harness.toString()), so it must be self-contained: no imports, nothing from outside
// its own body. It reads the block from #leaf-boot, sets up the canvas or the three.js
// scene, runs the block, drives onFrame, pauses everything it can reach on request,
// and reports errors to leaf instead of the console.

export function harness(win: Window): void {
  const w = win as any;
  const doc = win.document;
  const boot = JSON.parse(doc.getElementById('leaf-boot')!.textContent!) as {
    kind: 'three' | 'canvas';
    code: string;
    theme: 'light' | 'dark';
    paused: boolean;
  };
  const post = (m: Record<string, unknown>) => win.parent.postMessage({ leaf: 'live', ...m }, '*');
  const SOURCE = 'leaf-block.js';

  let paused = false;
  let failed = false;
  let theme = boot.theme;

  // ---- errors: one report, then the pane stops ----
  // The block runs inside a wrapper function, so its line 1 is some lines into the
  // wrapper; measure how many with a probe built the same way.
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const lineIn = (stack: string | undefined): number | undefined => {
    const m = new RegExp(`${SOURCE.replace('.', '\\.')}:(\\d+)`).exec(stack ?? '');
    return m ? Number(m[1]) : undefined;
  };
  let offset = 0;
  try {
    new AsyncFunction(`throw new Error()\n//# sourceURL=${SOURCE}`)().catch((e: Error) => {
      offset = (lineIn(e.stack) ?? 1) - 1;
    });
  } catch {
    // No line numbers then.
  }
  const report = (e: unknown, raw?: number) => {
    if (failed) return;
    failed = true;
    const at = raw ?? lineIn(e instanceof Error ? e.stack : undefined);
    const line = at !== undefined && at - offset >= 1 ? at - offset : undefined;
    post({ type: 'error', message: String(e instanceof Error ? e : (e ?? 'Error')), line });
  };
  win.addEventListener('error', (e) => {
    e.preventDefault();
    report(e.error ?? e.message, e.filename?.endsWith(SOURCE) ? e.lineno : undefined);
  });
  win.addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    report(e.reason);
  });

  // ---- animation frames, held back while paused ----
  const nativeRaf = win.requestAnimationFrame.bind(win);
  const nativeCaf = win.cancelAnimationFrame.bind(win);
  const queued = new Map<number, FrameRequestCallback>();
  let rafIds = 0;
  let pending = 0;
  const pump = () => {
    if (paused || pending || queued.size === 0) return;
    pending = nativeRaf((ts) => {
      pending = 0;
      const due = [...queued.values()];
      queued.clear();
      for (const cb of due) cb(ts);
    });
  };
  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    queued.set(++rafIds, cb);
    pump();
    return rafIds;
  };
  w.cancelAnimationFrame = (id: number) => void queued.delete(id);

  // ---- timers that keep their remaining time across a pause ----
  const nativeSet = win.setTimeout.bind(win);
  const nativeClear = win.clearTimeout.bind(win);
  type Timer = {
    fn: unknown;
    args: unknown[];
    delay: number;
    repeat: boolean;
    due: number;
    native?: number;
    left?: number;
  };
  const timers = new Map<number, Timer>();
  let timerIds = 0;
  const arm = (id: number, t: Timer, wait: number) => {
    t.due = Date.now() + wait;
    t.left = undefined;
    t.native = nativeSet(() => fire(id), wait) as unknown as number;
  };
  const fire = (id: number) => {
    const t = timers.get(id);
    if (!t) return;
    t.native = undefined;
    if (t.repeat) arm(id, t, t.delay);
    else timers.delete(id);
    if (typeof t.fn === 'function') t.fn(...t.args);
  };
  const add =
    (repeat: boolean) =>
    (fn: unknown, delay?: number, ...args: unknown[]) => {
      const t: Timer = { fn, args, delay: Math.max(0, Number(delay) || 0), repeat, due: 0 };
      timers.set(++timerIds, t);
      if (paused) t.left = t.delay;
      else arm(timerIds, t, t.delay);
      return timerIds;
    };
  const clear = (id: number) => {
    const t = timers.get(id);
    if (!t) return;
    if (t.native !== undefined) nativeClear(t.native);
    timers.delete(id);
  };
  w.setTimeout = add(false);
  w.setInterval = add(true);
  w.clearTimeout = clear;
  w.clearInterval = clear;

  // ---- pause and play ----
  const heldAnimations = new Set<Animation>();
  const heldMedia = new Set<HTMLMediaElement>();
  let last: number | null = null;
  const setPaused = (p: boolean) => {
    if (p === paused) return;
    paused = p;
    if (p) {
      if (pending) nativeCaf(pending);
      pending = 0;
      const now = Date.now();
      for (const t of timers.values()) {
        if (t.native === undefined) continue;
        nativeClear(t.native);
        t.native = undefined;
        t.left = Math.max(0, t.due - now);
      }
      for (const a of doc.getAnimations?.() ?? []) {
        if (a.playState !== 'running') continue;
        a.pause();
        heldAnimations.add(a);
      }
      for (const m of doc.querySelectorAll<HTMLMediaElement>('video, audio')) {
        if (m.paused) continue;
        m.pause();
        heldMedia.add(m);
      }
    } else {
      last = null;
      for (const [id, t] of timers) if (t.native === undefined) arm(id, t, t.left ?? t.delay);
      for (const a of heldAnimations) a.play();
      heldAnimations.clear();
      for (const m of heldMedia) m.play()?.catch?.(() => {});
      heldMedia.clear();
      pump();
    }
  };

  // ---- theme ----
  Object.defineProperty(w, 'theme', { get: () => theme, configurable: true });
  win.addEventListener('message', (e) => {
    if (e.source !== win.parent) return;
    const d = e.data as { leaf?: string; type?: string; theme?: 'light' | 'dark' };
    if (!d || d.leaf !== 'live') return;
    if (d.type === 'pause') setPaused(true);
    else if (d.type === 'play') setPaused(false);
    else if (d.type === 'theme' && (d.theme === 'light' || d.theme === 'dark')) {
      theme = d.theme;
      doc.documentElement.dataset.theme = theme;
      win.dispatchEvent(new Event('themechange'));
    }
  });

  // ---- the frame loop ----
  const callbacks: ((t: number, dt: number) => void)[] = [];
  let elapsed = 0;
  let running = false;
  let firstOnly = boot.paused;
  let draw: (() => void) | null = null;
  let manual = false;
  const loop = (ts: number) => {
    if (failed) return;
    const dt = last === null ? 0 : ts - last;
    last = ts;
    elapsed += dt;
    try {
      for (const cb of callbacks) cb(elapsed, dt);
      if (draw && !manual) draw();
    } catch (e) {
      report(e);
      return;
    }
    if (firstOnly) {
      firstOnly = false;
      setPaused(true);
    }
    w.requestAnimationFrame(loop);
  };
  const start = () => {
    if (running) return;
    running = true;
    w.requestAnimationFrame(loop);
  };
  w.onFrame = (fn: (t: number, dt: number) => void) => {
    callbacks.push(fn);
    start();
  };
  w.manual = () => {
    manual = true;
  };

  // ---- the stage: a canvas, or a three.js scene ----
  const size = () => ({
    width: win.innerWidth || doc.documentElement.clientWidth || 300,
    height: win.innerHeight || doc.documentElement.clientHeight || 150,
  });
  const dpr = win.devicePixelRatio || 1;
  if (boot.kind === 'canvas') {
    const canvas = doc.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    doc.body.append(canvas);
    const ctx = canvas.getContext('2d')!;
    let { width, height } = size();
    const fit = () => {
      ({ width, height } = size());
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    win.addEventListener('resize', fit);
    w.canvas = canvas;
    w.ctx = ctx;
    Object.defineProperty(w, 'width', { get: () => width, configurable: true });
    Object.defineProperty(w, 'height', { get: () => height, configurable: true });
  } else {
    try {
      const THREE = w.THREE;
      const { width, height } = size();
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height);
      doc.body.append(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
      camera.position.z = 5;
      win.addEventListener('resize', () => {
        const s = size();
        renderer.setSize(s.width, s.height);
        camera.aspect = s.width / s.height;
        camera.updateProjectionMatrix();
      });
      w.renderer = renderer;
      w.scene = scene;
      w.camera = camera;
      draw = () => renderer.render(scene, camera);
    } catch (e) {
      report(e);
      return;
    }
  }

  // ---- run the block ----
  let block: () => Promise<unknown>;
  try {
    block = new AsyncFunction(`${boot.code}\n//# sourceURL=${SOURCE}`);
  } catch (e) {
    report(e);
    return;
  }
  block().then(
    () => {
      if (failed) return;
      if (draw) start();
      post({ type: 'ready' });
    },
    (e) => report(e),
  );
}
