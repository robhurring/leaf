# leaf Diagrams and Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mermaid, PlantUML, and Excalidraw render inline and as files; every visual block zooms into a Stage with a floating toolbox (hand, zoom, pinch, pencil with brush sizes and red/green/blue) where strokes fade like invisible ink or stay sticky for the session.

**Architecture:** Three new viewers register in the existing viewer registry (file extensions and fence languages). One `Stage` component owns pan/zoom (a CSS transform on a content layer) and hosts any viewer's `Rich` component plus an SVG drawing layer in content coordinates. Strokes live in an in-memory zustand store keyed by `{ docPath, blockHash }`. The inline block toolbar (zoom in, copy source, copy as image, download) is one shared component driven by each viewer's `actions`.

**Tech Stack:** mermaid, @excalidraw/excalidraw (lazy), pako (deflate for PlantUML URLs), zustand, existing React/Vite/vitest/Playwright setup.

**Spec:** `.superpowers/specs/2026-10-24-leaf-design.md` §7.7, §8.5, §8.5a, §8.6.

## Global Constraints

- Viewers never implement zoom or drawing; the Stage does. _(§8.5)_
- `render/` never imports `viewers/` or `stage/`; viewers register fence languages through the block registry as the csv viewer does. _(§7.1)_
- Diagram renders are memoized on the content hash so live edits elsewhere in the document do not re-render them. _(§7.5)_
- Nothing is persisted to localStorage for strokes: session memory only. _(§8.6)_
- PlantUML renders only when `config.plantumlUrl` is set; otherwise the source shows as a code block with a one-line hint. _(§6.1)_
- Every new capability is demonstrated in `examples/` and covered by the smoke test. _(§9)_
- Commits end with `Claude-Session: https://claude.ai/code/session_012FN6bb8ockWHy6tJQ9A3Lk`.

## Review Focus

1. **A mermaid block with a syntax error** must show the error text in place, never a blank block or a thrown render. Pinned in Task 3.
2. **Zooming with the wheel over the Stage** must zoom around the cursor and never scroll the document behind it. Pinned in Task 1.
3. **Drawing then navigating away and back** keeps sticky strokes and drops faded ones. Pinned in Task 2.
4. **A changed diagram source** keeps the Stage usable and marks old sticky strokes as stale. Pinned in Task 2.
5. **Copy as image without clipboard permission** fails quietly with a visible "Copy failed" state, not an uncaught rejection. Pinned in Task 6.

---

### Task 1: Stage with pan, zoom, pinch, and the floating toolbox

**Files:** create `ui/src/stage/{Stage,Toolbox,viewport}.tsx|ts`, `ui/src/store/stage.ts`; test `ui/test/viewport.test.ts`, `ui/test/Stage.test.tsx`.
**Interfaces:** `createViewport()` pure math `{ scale, x, y }` with `zoomAt(point, factor)`, `panBy(dx, dy)`, `fit(contentW, contentH, viewW, viewH)`, `reset()`, clamped 0.1–8. `useStage` store: `{ open: StageContent | null; tool: 'hand' | 'pencil'; color: 'red'|'green'|'blue'; brush: 'small'|'medium'|'large'; sticky: boolean; openStage(content); close() }` where `StageContent = { docPath, blockHash, viewer: Viewer, props: ViewerProps, canDraw: boolean }`. `<Stage />` renders the open content, toolbox, wheel (ctrl/pinch) zoom around cursor, hand drag, double-click reset, Esc close, and prevents document scroll.

### Task 2: Drawing layer and annotations store (invisible ink, sticky, stale)

**Files:** create `ui/src/stage/Draw.tsx`, `ui/src/store/annotations.ts`; test `ui/test/annotations.test.ts`, `ui/test/Draw.test.tsx`.
**Interfaces:** `Stroke = { id, docPath, blockHash, points: [number, number][], color, width, sticky, createdAt }`. Store: `strokesFor(docPath, blockHash)`, `add(stroke)`, `clear(docPath, blockHash)`, `expire(now)` (removes non-sticky strokes older than 8 s), `markStale(docPath, newHash)`. `Draw` is an SVG overlay in content coordinates: pencil pointer events create a stroke (polyline, stroke-width by brush, color by R/G/B), non-sticky strokes get the `leaf-ink-fade` class and are removed after 8 s; stale sticky strokes get `leaf-ink-stale`.

### Task 3: Mermaid viewer

**Files:** create `ui/src/viewers/mermaid/index.tsx`; register; test `ui/test/mermaid.test.tsx` (mock `mermaid.render` to return an SVG string; one test asserts an error message renders when render rejects). Inline = SVG via `dangerouslySetInnerHTML` of the sanitized mermaid output (mermaid sanitizes), memoized by hash; Rich same; `stage: { pan, zoom, draw }`; theme follows appearance (`mermaid.initialize({ theme: dark ? 'dark' : 'default' })`).

### Task 4: PlantUML viewer

**Files:** create `ui/src/viewers/plantuml/{encode.ts,index.tsx}`; test `ui/test/plantuml.test.tsx` (encoder known vector: `@startuml\nA -> B\n@enduml` → the documented PlantUML text encoding; viewer renders `<img src="{plantumlUrl}/svg/{encoded}">` when configured, else a code block with hint).

### Task 5: Excalidraw viewer

**Files:** create `ui/src/viewers/excalidraw/index.tsx`; lazy `import('@excalidraw/excalidraw')` → `exportToSvg`; test with the module mocked. Files `.excalidraw` and fences `excalidraw` (JSON scene). Invalid JSON → error state.

### Task 6: Block toolbar and actions (zoom in, copy source, copy as image, download)

**Files:** create `ui/src/components/BlockFrame.tsx` (wraps any inline visual block with the hover toolbar), `ui/src/stage/image.ts` (`svgToPngBlob`), modify `CodeBlock` to use BlockFrame for consistency; test `ui/test/BlockFrame.test.tsx` (actions call clipboard; failure shows "Copy failed").

### Task 7: Examples, smoke test, docs

**Files:** `examples/diagrams.md` (mermaid flow + sequence, plantuml, excalidraw fences, a broken mermaid), `examples/viewers/{flow.mmd,sequence.puml,sketch.excalidraw}`, README/examples index; `e2e/smoke.spec.ts`: diagrams page renders an svg, zoom-in opens the Stage, pencil drag adds a path, sticky survives navigation. `bin/test` green.
