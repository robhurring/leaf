# Live animation blocks

## Intent

Rob wants a nice way to illustrate things in his documents when presenting or sharing
them: something that moves, written as a three.js scene or a 2D canvas sketch right in
the markdown. A fenced code block of one of the new kinds is
replaced by a live pane, the way mermaid blocks become diagrams today. "JS-fiddle-ish":
the pane runs the code, the code is one toggle away.

Success: Rob writes (or Claude writes for him) a ` ```three ` block in a note, opens it in
leaf, and sees a spinning scene in the document; edits the file and the pane restarts
with the new code; zooms it to the Stage to present it large; ships with examples
that show off what's possible.

## Goals

- Two new fence languages, each rendered as a live pane:
  - `three` — JavaScript with three.js ready: `THREE`, plus `scene`, `camera`,
    `renderer` already made and sized to the pane, and `onFrame(fn)` where
    `fn(t, dt)` gets ms since start and since the last frame. The harness renders
    `scene` with `camera` after the frame callbacks each frame, unless the block calls
    `manual()` (it then renders itself). The pane resizes the renderer and camera
    aspect with the pane.
  - `canvas` — JavaScript with a 2D canvas ready: `canvas`, `ctx`, `width`, `height`
    (CSS px, the canvas is scaled for device pixel ratio), and `onFrame(fn)`.
- **Sandboxed, always.** Every pane is an `<iframe sandbox="allow-scripts">` with
  `srcdoc` — never `allow-same-origin` — so it has an opaque origin: no access to
  leaf's DOM, storage, Tauri/IPC, the websocket, or files. The frame document carries
  a CSP meta that blocks all network (`default-src 'none'; script-src 'unsafe-inline'
  'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:;
  font-src data:`). Because of this, panes run automatically for any file, from anyone;
  there is no per-file trust prompt. (Decided by Claude; Rob didn't pick a trust model.)
- **Bundled libraries, offline.** three.js is a dependency of `packages/ui` (pin a
  current release) and its source is inlined into the frame (the opaque-origin frame
  can't load leaf's own URLs reliably). Load it lazily, like mermaid, only when a
  `three` block exists. Cache the library text once per session. Block code reaches
  libraries through globals, never `import`: `THREE`, and `OrbitControls` (the one
  addon that ships). Block code runs as the body of an async function, so top-level
  `await` works. (Claude's call.)
- **Pane chrome**, in the existing `BlockFrame` hover toolbar style:
  play/pause, restart, view code (swaps the pane for the highlighted source, the
  existing code block view), and copy source (BlockFrame's existing copy). Zoom-in to
  the Stage shows the pane larger: the viewer's `Rich` component is the same pane
  filling the Stage. It is a second, fresh instance (the animation starts over); the
  inline pane pauses while the Stage is open. No pan/draw for these. (Claude's call.)
- **Polite with the CPU.** A pane starts when it scrolls into view and pauses when it
  leaves, when the window/tab is hidden, or when the user pauses it. Pausing stops
  everything the harness can reach inside the frame: `requestAnimationFrame` callbacks
  (wrapped, so author code using it directly pauses too), `setTimeout`/`setInterval`
  (wrapped; timers don't fire while paused and resume after), CSS/Web Animations
  (`document.getAnimations()` paused and resumed), and `<video>`/`<audio>` elements.
  `onFrame` time stops advancing while paused. (Claude's call.) Users with reduced motion get panes that
  start paused, showing the first frame, with play available.
- **Size.** Fixed height, never sized to content: default 320px, full content width. Fence meta can set it:
  ` ```three height=480 `. Clamp to 120–1200. This needs the fence meta passed through
  to the viewer (today `registries.blocks` gets `meta` but the viewer bridge drops it).
- **Theme.** The frame knows leaf's appearance: `document.documentElement.dataset.theme`
  is `light`/`dark` inside the frame, a `theme` global is set, and the default frame
  background follows leaf's page background. A theme switch restarts nothing; it posts
  the new theme and sets the attribute (code can listen for `themechange` on `window`).
- **Errors show in place.** Syntax and runtime errors (including unhandled rejections)
  inside the frame post to the parent, which shows them under the pane in the style of
  `DiagramError`, with the message and the line within the block when known.
- **Live reload.** When the block's source changes, the pane restarts with new code.
  Edits elsewhere in the document don't restart it (memoize on content hash, like
  mermaid).
- **Examples.** `examples/animations.md` showcasing each kind, with real eye candy:
  e.g. a lit, rotating three.js object with orbit-ish auto camera motion, a particle
  field or wave surface in three.js, 2D canvas sketches that explain something (a
  flow field, a sine wave built from a turning circle, a sorting algorithm stepping),
  and one deliberately broken block showing the error view. Panes take pointer input
  (OrbitControls drag in a three example), which matters when presenting.
  Link it from `examples/README.md` like the other examples.
- **Docs.** README section on live blocks: the two languages, the globals each gets,
  `height=`, and the sandbox (what panes can't do).

## Non-goals

- Editing code inside leaf. leaf is a reader; you edit in your editor, leaf reloads.
- Loading arbitrary libraries / imports from the network or from the repo. Only what
  leaf bundles (three.js, including the addons Rich wants: OrbitControls). An `import`
  from a URL fails under the CSP and shows as an error.
- p5, d3, other libraries (later, if wanted).
- Live HTML/CSS blocks (an `html-live` kind was considered; Rob dropped it).
- Whole-file viewers (`.three.js` files etc.). Fenced blocks only.
- Messages from a pane to leaf beyond ready and error. A pane can't navigate leaf,
  open links in leaf, or read the document.

## Anti-goals

- Anything that lets document code reach leaf, the disk, or the network. If a choice
  trades the sandbox for convenience, the sandbox wins.
- A long document with several panes spinning the fan when they're off screen.
- Hijacking ordinary code: ` ```js `, ` ```html `, ` ```javascript ` stay highlighted
  code exactly as today.

## Constraints

- Must work in both shells: the Tauri app (WKWebView; `csp` is `null` in
  `tauri.conf.json`) and the browser/serve mode. e2e runs chromium, webkit, firefox.
- Follows the viewer pattern: a `Viewer` in `packages/ui/src/viewers/<name>/` claiming
  fence langs, registered in `viewers/index.ts`, rendered inside `BlockFrame`.
- The existing smoke e2e test opens every example and asserts no console errors;
  `examples/animations.md` must pass it. The harness catches errors inside the frame
  (`error`/`unhandledrejection` handlers that prevent the default console report) and
  posts them to leaf, so the deliberately broken example (a runtime error such as an
  undefined name, not a blocked network request) logs nothing to any console. Frame
  console messages stay counted by the smoke test. (Claude's call.)
- Repo conventions: tests first (vitest + happy-dom for UI, Playwright e2e),
  `bin/lint` and `bin/test` green, comment style like the surrounding code.

## Left to the builder

- How the srcdoc is assembled (harness script + library + user code), and how the
  parent/frame message protocol is shaped (validate `event.source` is that frame's
  `contentWindow`; ignore everything else).
- How user code is wrapped so its globals are in scope and line numbers in errors map
  back to the block.
- Whether one viewer handles all three langs or three small ones share a pane component.
- Exact icons and toolbar placement within BlockFrame's existing toolbar.
- Testing in happy-dom: assert the iframe's `sandbox` attribute, CSP, srcdoc
  contents, pause/play messages; real rendering is covered by e2e.
