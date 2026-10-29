# Live animation blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ` ```three ` and ` ```canvas ` fenced blocks render as live, sandboxed, pausable animation panes, with examples for presenting.

**Architecture:** A `live` viewer claims the `three` and `canvas` fence languages and renders a `LivePane`: an `<iframe sandbox="allow-scripts" srcdoc>` whose document is assembled by `buildSrcdoc` from a CSP meta, the block's code (as escaped JSON), the library sources (three only), and a self-contained `harness` function serialized with `Function.prototype.toString`. Parent and frame talk by `postMessage` (`play`/`pause`/`restart`/`theme` down; `ready`/`error` up). The pane owns its own small control overlay; BlockFrame gives copy and the Stage zoom.

**Tech Stack:** React 19, TypeScript, Vite (`?raw` imports), three.js 0.186.x, vitest + happy-dom, Playwright.

**Spec:** `.superpowers/specs/2026-10-29-animations-design.md`

## Global Constraints

- Fence languages exactly `three` and `canvas`. ` ```js `, ` ```javascript `, ` ```html ` render exactly as today.
- iframe `sandbox` attribute is exactly `allow-scripts`. Never `allow-same-origin`.
- Frame CSP (meta, first element in `<head>`): `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:` (Ruling vs spec: `blob:` added to `script-src` so the frame can import the three.js module text it turns into blob URLs itself; no network origin is allowed.)
- Height: default 320px; fence meta `height=N` clamped to 120–1200.
- Block globals — `three`: `THREE`, `OrbitControls`, `scene`, `camera`, `renderer`, `onFrame(fn)`, `manual()`, `theme`; `canvas`: `canvas`, `ctx`, `width`, `height`, `onFrame(fn)`, `theme`. `fn(t, dt)` gets ms since start and since last frame. Block code is the body of an async function.
- Libraries bundled, loaded lazily (like mermaid) only when a `three` block renders; library text cached once per session.
- Errors inside the frame never reach any console: harness `error`/`unhandledrejection` handlers call `preventDefault()` and post `{type:'error'}`.
- Specs/plans live in `.superpowers/`. Commits end with `Claude-Session: https://claude.ai/code/session_012FN6bb8ockWHy6tJQ9A3Lk`.
- `bin/lint` and `bin/test` green at the end of every task.

## Review Focus

1. Block code containing `</script>` or `<!--` must not break out of the frame's script; it runs as written. (Test in Task 2.)
2. Messages from anything other than this pane's own `contentWindow` (another pane, the page, a forged `postMessage`) are ignored. (Test in Task 4.)
3. Editing text elsewhere in the document must not restart a pane; editing the block must. (Test in Task 4.)
4. A document with many panes: only the ones on screen run; a hidden window pauses all. (Test in Task 4.)
5. A thrown error after a `pause` → `play` cycle, and errors in `onFrame` callbacks, still show in the pane's error view and stop that frame loop rather than flooding (one error shown, loop stopped). (Test in Task 3.)

---

### Task 1: Fence meta reaches viewers; in-place zoom only for zoomable viewers

**Files:**
- Modify: `packages/ui/src/viewers/types.ts` (ViewerProps), `packages/ui/src/viewers/index.ts` (block bridge), `packages/ui/src/components/BlockFrame.tsx` (`zoomable`)
- Test: `packages/ui/test/viewers.test.tsx`, `packages/ui/test/BlockFrame.test.tsx`

**Interfaces:**
- Produces: `ViewerProps.meta?: string` — the fence info string after the language (e.g. `'height=480'`), `''` when none. BlockFrame shows in-place zoom/pan tools only when `viewer.stage?.zoom` is true; "Open zoomed view" still shows for any viewer with `stage` defined.

- [ ] **Step 1: Write failing tests**
  - viewers.test: register a throwaway viewer claiming lang `metatest` whose Inline renders `props.meta`; render the block via `registries.blocks.resolve('metatest')!.render('x', 'height=480', ctx)`; expect text `height=480`.
  - BlockFrame.test: a viewer with `stage: {}` shows a button named `Open zoomed view` and no button named `Zoom in` or `Pan`; mermaid still shows `Zoom in`.
- [ ] **Step 2:** `npx vitest run packages/ui/test/viewers.test.tsx packages/ui/test/BlockFrame.test.tsx` — Expected: the two new tests FAIL.
- [ ] **Step 3:** Pass `meta` through the bridge in `viewers/index.ts` (`render: (code, meta, ctx)`); set `zoomable = visual && !!viewer.stage?.zoom && !slot`.
- [ ] **Step 4:** Same command — Expected: PASS. Then `bin/lint`.
- [ ] **Step 5:** Commit "Fence meta reaches viewers".

### Task 2: The frame document

**Files:**
- Create: `packages/ui/src/viewers/live/frame.ts`
- Test: `packages/ui/test/liveFrame.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LiveKind = 'three' | 'canvas';
  export type Theme = 'light' | 'dark';
  export type Libs = { core: string; module: string; orbit: string }; // three only
  export type Boot = { kind: LiveKind; code: string; theme: Theme; paused: boolean; libs?: Libs };
  export const FRAME_CSP: string;            // exactly the Global Constraints value
  export function paneHeight(meta: string | undefined): number; // 320 default, clamp 120–1200
  export function buildSrcdoc(boot: Boot, harnessSource: string): string;
  // messages
  export type ToFrame = { leaf: 'live'; type: 'play' | 'pause' | 'restart' } | { leaf: 'live'; type: 'theme'; theme: Theme };
  export type FromFrame = { leaf: 'live'; type: 'ready' } | { leaf: 'live'; type: 'error'; message: string; line?: number };
  export function isFromFrame(data: unknown): data is FromFrame;
  ```
- The boot object goes into the srcdoc as `<script type="application/json" id="leaf-boot">` with every `<` written as `<` (and ` `/` ` escaped); the harness reads and `JSON.parse`s it.

- [ ] **Step 1: Write failing tests** (`liveFrame.test.ts`):
  - `paneHeight(undefined)` → 320; `'height=480'` → 480; `'height=50'` → 120; `'height=5000'` → 1200; `'height=abc foo'` → 320.
  - `buildSrcdoc(...)` puts `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` before any `<script`; contains `data-theme="dark"` on `<html>` for a dark boot.
  - Escaping: for `code = 'const s = "</script><!--";'`, the srcdoc contains no second `</script>` inside the boot block, and `JSON.parse` of the boot element's text (parse the srcdoc with `DOMParser`) gives back the exact code.
  - `isFromFrame({leaf:'live',type:'ready'})` true; `{type:'ready'}`, `null`, `{leaf:'live',type:'error'}` (no message) false.
- [ ] **Step 2:** `npx vitest run packages/ui/test/liveFrame.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `frame.ts`. `buildSrcdoc` appends `<script>(${harnessSource})(window)</script>` after the boot block. Body has `margin:0; overflow:hidden`, background `#ffffff`/`#0d1117` by theme (same as mermaid's page colors).
- [ ] **Step 4:** Same command — PASS; `bin/lint`.
- [ ] **Step 5:** Commit "The live pane's frame document".

### Task 3: The harness that runs inside the frame

**Files:**
- Create: `packages/ui/src/viewers/live/harness.ts`
- Test: `packages/ui/test/liveHarness.test.ts`

**Interfaces:**
- Consumes: `Boot`, `ToFrame`, `FromFrame` (Task 2).
- Produces: `export function harness(win: Window): void` — fully self-contained (no imports, no references outside its body; it is serialized with `.toString()`), reads `#leaf-boot`, and:
  - wraps `win.requestAnimationFrame`/`cancelAnimationFrame`, `setTimeout`/`setInterval`/`clear*` so nothing fires while paused (timers keep their remaining delay and resume);
  - on `pause`: also `document.getAnimations().forEach(a => a.pause())` and pauses playing `<video>/<audio>` (remembering which), and the reverse on `play`;
  - `onFrame(fn)` callbacks get `(t, dt)` with `t` frozen while paused;
  - `canvas` kind: creates a full-size `<canvas>` scaled by `devicePixelRatio`, `ctx` pre-scaled, `width`/`height` in CSS px, updated on resize;
  - `three` kind: turns `libs` into blob-URL modules (rewrite `./three.core.min.js` in `module` and `'three'` in `orbit` to the blob URLs), `await import()`s them, creates `scene`, `PerspectiveCamera(50, aspect, 0.1, 1000)` at `z=5`, `WebGLRenderer({antialias:true})` sized to the window with DPR, resizes on `resize`, and renders after `onFrame` callbacks each frame unless `manual()` was called;
  - runs block code as `new AsyncFunction(...globalNames, code)(...values)`; maps an error's line in the block (from the stack or `lineno`, minus the wrapper's offset) into `line`;
  - posts `ready` after the block's function resolves; posts `error` on throw, on `error`/`unhandledrejection` (with `preventDefault()`), and on an `onFrame` throw — after which the frame loop stops (one error, no flood);
  - `restart` → `location.reload()` (srcdoc reload re-runs everything).
  - `theme` message → sets `document.documentElement.dataset.theme`, the `theme` global, and dispatches `new Event('themechange')` on `window`;
  - `boot.paused` true → runs exactly one frame (so the first picture shows), then pauses.
  - Only accepts messages whose `source === win.parent` and `data.leaf === 'live'`; posts to `win.parent` with target `'*'` (opaque origin).

- [ ] **Step 1: Write failing tests** (happy-dom; build a document with a `#leaf-boot` JSON for `kind:'canvas'`, stub `parent.postMessage` with `vi.fn`, run `harness(window)`, use fake timers):
  - posts `{leaf:'live',type:'ready'}` after code `onFrame(() => {})`.
  - code `undefinedName()` on line 2 posts `{type:'error', message: /undefinedName/, line: 2}`.
  - `onFrame` callback count stops increasing after a `pause` message and resumes after `play`; `t` passed after resume continues from where it paused (no jump by the paused duration).
  - a `setTimeout(fn, 100)` started, then `pause` at 50ms, advance 200ms → not called; `play`, advance 60ms → called once.
  - an `onFrame` that throws posts exactly one error after several frames.
  - a message with `source` not `window.parent` is ignored.
  - a `theme` message sets `data-theme="light"` and fires `themechange` once.
  - with `paused: true` in the boot, `onFrame` runs exactly once, then not again until `play`.
  - `harness.toString()` evaluated with `new Function('return ' + src)()` still works (self-containment check: run the evaluated copy for the `ready` test).
- [ ] **Step 2:** `npx vitest run packages/ui/test/liveHarness.test.ts` — FAIL.
- [ ] **Step 3:** Implement. three-kind code paths are verified by e2e (Task 5), not happy-dom.
- [ ] **Step 4:** PASS; `bin/lint`.
- [ ] **Step 5:** Commit "The harness inside live panes".

### Task 4: The pane and the viewer

**Files:**
- Create: `packages/ui/src/viewers/live/index.tsx` (viewer `live`), `packages/ui/src/viewers/live/LivePane.tsx`, `packages/ui/src/viewers/live/libs.ts`
- Modify: `packages/ui/src/viewers/index.ts` (register), `packages/ui/package.json` (`three` ^0.186.1, `@types/three` dev), `packages/ui/src/icons/` (Play, Pause, Restart, Code if missing), `packages/ui/src/styles/leaf.css` (`.leaf-live*`)
- Test: `packages/ui/test/live.test.tsx` — note `live.test.tsx` exists already (live reload); name this `livePane.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `export const live: Viewer` with `id: 'live'`, `matches: { lang: ['three', 'canvas'] }`, `stage: {}`, `Inline` and `Rich` both `LivePane` (Rich fills its container's height instead of `paneHeight`). `libs.ts`: `export function loadThreeLibs(): Promise<Libs>` using `import('three/build/three.core.min.js?raw')`, `import('three/build/three.module.min.js?raw')`, `import('three/examples/jsm/controls/OrbitControls.js?raw')`, cached in a module-level promise, wrapped in `track(load(...))` like mermaid.
- LivePane behavior:
  - iframe `sandbox="allow-scripts"`, `title="<lang> animation"`, `srcdoc` from `buildSrcdoc`, memoized on `contentHash(code)` + kind (theme changes post `theme`, never rebuild).
  - Running state = `inView && !document.hidden && !userPaused && !stageOpenForThisBlock`; on change posts `play`/`pause`. `inView` from IntersectionObserver (treated as true when `IntersectionObserver` is undefined). Reduced motion → `userPaused` starts true, boot `paused: true`.
  - `stageOpenForThisBlock`: `useStage(s => s.open)` matches this `docPath` and `contentHash(code)`, and this pane is the Inline one.
  - Accepts messages only when `e.source === iframe.contentWindow` and `isFromFrame(e.data)`.
  - Overlay controls (bottom-left, shown on hover/focus, `.leaf-tool` buttons): `Pause`/`Play` (aria-pressed none; label switches), `Restart` (posts `restart`, clears the error), `View code` (aria-pressed; swaps the iframe for `<CodeBlock>` of the source in `javascript` — the existing highlighted view — and back).
  - Error → `<DiagramError kind={lang} message={line ? \`line ${line}: ${message}\` : message} />` under the pane; the pane stays.
  - Container `data-state` = `loading` | `running` | `paused` | `error` (for e2e).

- [ ] **Step 1: Write failing tests** (`livePane.test.tsx`, render via `registries.blocks.resolve('canvas')!.render(code, meta, ctx)`; `loadThreeLibs` mocked):
  - `viewers.forLang('three')?.id` and `forLang('canvas')?.id` are `live`; `forLang('js')?.id` is not `live`.
  - iframe has `sandbox` exactly `allow-scripts`; height style 480px for meta `height=480`; srcdoc contains the code.
  - a `message` event with `source: iframe.contentWindow` and `{leaf:'live',type:'error',message:'boom',line:3}` shows `line 3: boom`; the same with `source: window` shows nothing (Review Focus 2).
  - clicking `Pause` posts `{leaf:'live',type:'pause'}` to `iframe.contentWindow` (spy on its `postMessage`) and the button becomes `Play`.
  - IntersectionObserver stub: leaving view posts `pause`, entering posts `play`; `document.hidden` + `visibilitychange` posts `pause` (Review Focus 4).
  - rerendering the document with the same block code keeps the same `srcdoc` string identity / no iframe remount; changed code changes srcdoc (Review Focus 3).
  - `View code` shows a `pre` with the source and hides the iframe.
  - `useStage.getState().openStage({...this block})` posts `pause` to the inline pane.
  - `matchMedia('(prefers-reduced-motion: reduce)')` true → first button is `Play` and the boot has `"paused":true`.
- [ ] **Step 2:** `npx vitest run packages/ui/test/livePane.test.tsx` — FAIL.
- [ ] **Step 3:** `npm i -w packages/ui three@^0.186.1 && npm i -D -w packages/ui @types/three`; implement; register `live` in `viewers/index.ts` (before `code`).
- [ ] **Step 4:** PASS; `bin/lint`; `bin/test` (whole suite).
- [ ] **Step 5:** Commit "Live animation panes for three and canvas blocks".

### Task 5: Examples, docs, end-to-end

**Files:**
- Create: `examples/animations.md`
- Modify: `examples/README.md` (Markdown list, after Diagrams: `- [Animations](./animations.md): live three.js and canvas blocks for illustrating ideas, a broken one, and presenting them in the Stage.`), `README.md` (a "Live animation blocks" section: the two languages, their globals, `height=`, the sandbox — no network, no access to leaf or files), `packages/ui/e2e/smoke.spec.ts`
- Test: `packages/ui/e2e/smoke.spec.ts`

**Example content** (each preceded by a sentence on what it illustrates; each must look good in light and dark):
1. `three`: a lit, slowly rotating torus knot with `OrbitControls` (drag to look around), `height=400`.
2. `three`: a wave surface (PlaneGeometry vertices displaced by `sin` over time) with a wireframe overlay.
3. `canvas`: a sine wave traced by a point on a turning circle (unit circle → sine), labels drawn on canvas.
4. `canvas`: a flow field of particles leaving trails.
5. `canvas`: bubble sort stepping through bars, one comparison per ~150ms, swapped bars highlighted, restarting when sorted.
6. `canvas`: a deliberately broken block (calls `undefinedThing()` on line 3), with a sentence saying it shows the error view.

- [ ] **Step 1: Write failing e2e** in `smoke.spec.ts`:
  - add `'animations.md'` to the examples list (no console errors, page or frames).
  - new test `live panes run, pause, and show errors`: goto `/animations.md`; first `.leaf-live` reaches `data-state="running"` (three's WebGL must init in all three browsers — if a headless browser has no WebGL, it must show the error view instead, and the test accepts `running` or a visible error only for that browser); the canvas sine pane reaches `running`; clicking its `Pause` gives `paused`; the broken pane shows text `line 3` and `undefinedThing`.
- [ ] **Step 2:** `npm run e2e -w packages/ui` (or `bin/test`) — FAIL (no example yet).
- [ ] **Step 3:** Write the example, README sections. If blob-URL module import fails in any engine (WebKit is the risk), Ruling: build a classic-script bundle of three + OrbitControls instead (an esbuild step via Vite's bundled esbuild in a tiny Vite plugin producing a `?three-iife` raw module) and record it in the ledger.
- [ ] **Step 4:** `bin/test` — all PASS; `bin/lint`; then `LEAF_APP=<scratchpad>/none.app bin/build` and open `examples/animations.md` in the built `leaf` binary to confirm panes run in the Tauri webview (screenshot).
- [ ] **Step 5:** Commit "Animation examples and docs".
