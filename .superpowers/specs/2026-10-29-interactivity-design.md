# Interactive documents

## Intent

Rob wants leaf documents to be interactive and illustrative: charts, maps, decks,
animations he can step through, while he presents or shares. "I want to have
interactive documents and charts." Everything lands on one branch,
`feat/interactivity`, that he explores and tests as it grows. The hard rule: opening
leaf stays fast. Every library loads only when a document uses it.

Builds on what's merged: live `three` / `canvas` panes (sandboxed frames), the Stage
(zoomed view), live updates, the viewer and block registries.

## Global rules

- **Startup stays small.** Each library is its own chunk, fetched the first time a
  document needs it. A check in the build fails if the entry chunk grows past a set
  budget (today's size plus a small margin).
- **Data renders in the page; code runs in the sandbox.** Charts, maps, decks, and 3D
  models are data (JSON, YAML, CSV, GeoJSON, markdown, STL), rendered directly. Only
  `three`, `canvas`/`.sketch`, and `d3` code runs, and only in the sandboxed frame.
- **Live.** Every view updates in place when its file, block, or the data file it reads
  changes.
- **Light and dark**, matching leaf.
- **Data files a block reads** are paths relative to the document (like links and
  images), read through the existing `read` message; a change event for that path
  re-reads it. No protocol change.
- Each phase updates the README and the examples gallery.

## Phase 1: charts, maps, standalone files, gallery

### Charts: ` ```chart ` and `.chart`

- Chart.js 4 (lazy). The block is a Chart.js config as YAML (JSON is valid YAML):
  `type`, `data`, `options`.
- leaf extension: `data: { from: ./sales.csv, x: month, y: [revenue, cost] }` reads
  rows from a CSV, JSON array, or JSON Lines file next to the document; each `y` column
  becomes a dataset. Inline `data` works as in Chart.js.
- Themed defaults: leaf's font and colors, grid and tick colors per appearance, a
  categorical palette for datasets without colors.
- Height: 320 by default, `height=` in the fence. Full window for `.chart` files.
- Updates animate in place (`chart.update()`), not rebuild.
- Errors (bad YAML, unknown chart type, missing column) show in place like diagrams.
- Zoom: the Stage gives it the whole area (like live panes).

### Maps: GeoJSON, TopoJSON, and logs

- `.geojson` / `.topojson` files open as maps; ` ```geojson ` and ` ```topojson `
  fences too.
- ` ```map ` takes YAML: `from:` a GeoJSON, TopoJSON, CSV, JSON, or JSON Lines file;
  for rows, `lat` and `lon` columns (auto-detected: lat/latitude, lon/lng/long/longitude),
  optional `color:` (a column, categorical legend), `label:`.
- Drawn as SVG with `d3-geo` and `topojson-client` (lazy): a bundled low-detail world
  outline (world-atlas countries 110m) behind the data, projection fitted to the data
  with padding (Equal Earth when the data spans much of the world).
- Points, lines, polygons. Hover shows the feature's properties or row. Over 20,000
  points: the first 20,000 and a note saying so.
- Zoom, pan, and draw in the Stage like diagrams (it's SVG).

### Standalone files, full window

- `.three` and `.sketch` open as full-window live panes (`.sketch` is canvas code;
  not `.canvas`, which Obsidian uses for its JSON boards).
- `.chart` as above. (`.d3` arrives with phase 3.)

### Gallery

- `examples/README.md` becomes the gallery of everything beyond GitHub Markdown, by
  kind, each linking to an example. New: `examples/charts.md`, `examples/maps.md`,
  data files (`examples/data/`: CSV, JSON Lines logs with lat/lon, GeoJSON,
  TopoJSON), and standalone `examples/files/*.chart`, `examples/animations/*.three`,
  `*.sketch`.
- README "What you get" lists charts, maps, and the file types.

## Phase 2: Marp decks

- Rendered with `@marp-team/marp-core` (lazy) so decks match Marp in VS Code and
  marp-cli: themes, directives, `---` slide breaks, raw HTML off.
- A `.md` with `marp: true` frontmatter opens as a deck; so does `.marp`. A toggle in
  the file header switches a Marp `.md` back to the plain document view.
- Deck view: one slide at a time scaled to fit, arrow keys / space / clicks, slide
  counter, thumbnail strip, **Present** (full screen).
- **Speaker view**: a second window (a real window in the app; a popup in a browser)
  with current and next slide, the slide's notes (Marp's comment notes), a timer, and
  the clock, synced with the presenting window both ways.
- Live: edits update in place, staying on the current slide.
- ` ```marp ` fences in any document: a mini deck with previous/next; the Stage shows
  it full size with a Present button.
- Deck CSS is isolated so a Marp theme can't restyle leaf (shadow root).

## Phase 3: step player, d3, sliders

- ` ```d3 ` blocks and `.d3` files: live panes (sandboxed) with D3 7 (lazy, bundled
  into the frame like three).
- **Player**: a block calls `player({ end, stops?, draw(t) })` (or `steps([...])`) and
  leaf shows a bar under the pane: play/pause, step back/forward (to the next stop),
  a scrubber, speed (0.5–4×). Space and arrows when the pane has focus. Works in
  `three`, `canvas`, and `d3` blocks.
- `sequence({ actors, requests, messages })` helper in `d3` blocks: the animated
  sequence diagram from the approved mockup (traffic as dots, sloped arrows for
  latency, busy bars, "now" line), driven by the player.
- **Sliders**: `param(name, initial, { min, max, step })` returns a live value; leaf
  shows labeled sliders under the pane.
- **Mermaid step-through**: ` ```mermaid steps ` reveals the diagram's nodes and
  edges in source order, one per step, with the player.

## Phase 4: extras

- `.stl` files open as 3D models (three's STL loader in the page, orbit to turn).
- An original pachinko-style game example (`examples/animations/*.sketch` or block):
  aim, launch a ball into pegs, combos; its own look and twist; not a copy of any
  existing game.

## Non-goals

- Tiles or any network for maps. Recharts. Python in the browser. Editing in leaf.
- Copying specific existing games.

## Left to the builder

Component structure, how side files are cached, chart palette values, map styling,
player message shapes, how Marp output is mounted, thumbnail rendering.
