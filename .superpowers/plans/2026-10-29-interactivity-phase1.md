# Interactivity, phase 1: charts, maps, standalone files, gallery

> Executed inline (superpowers:executing-plans). Spec: `.superpowers/specs/2026-10-29-interactivity-design.md`.

**Goal:** ` ```chart ` / `.chart` (Chart.js), maps from GeoJSON / TopoJSON / CSV / JSON Lines,
full-window `.three` / `.sketch`, an entry-size budget, and the examples gallery.

## Global constraints

- Each library a lazy chunk: `chart.js/auto`, `d3-geo`, `topojson-client`, `world-atlas/countries-110m.json`.
- Entry chunk budget enforced in `bin/build` (fails over budget).
- Data files resolve with `resolveRelative(docPath, rel)` and are read through the documents store.
- Commits end with `Claude-Session: https://claude.ai/code/session_012FN6bb8ockWHy6tJQ9A3Lk`.

## Tasks

1. **Data files.** `packages/ui/src/data/rows.ts`: `parseRows(text, path): Row[]` (CSV via
   the csv viewer's parser, `.json` array, `.jsonl`/`.ndjson` lines), `latLonKeys(row)`.
   `packages/ui/src/data/useDataFile.ts`: `useDataFile(docPath, rel)` → `{ text?, error?, path }`,
   reading through the documents store and re-reading on a change event for that path
   (documents store keeps a `watched` set). Tests: `test/dataRows.test.ts`, `test/dataFile.test.tsx`.
2. **Charts.** `viewers/chart/`: viewer `chart` (lang `chart`, ext `.chart`), YAML config,
   `data.from` rows → datasets, themed defaults, `height=`, update in place, errors in place,
   `stage: {}`. Test `test/chart.test.tsx` (Chart.js mocked: config handed over, update not
   rebuild, error text).
3. **Maps.** `viewers/map/`: viewer `map` (langs `geojson`, `topojson`, `map`; ext `.geojson`,
   `.topojson`), SVG with world outline, fitted projection, points/lines/polygons, color legend,
   hover properties, 20k cap note, `stage: { pan, zoom, draw }`. Test `test/map.test.tsx`
   (rows → points, topojson → features, cap note, error text).
4. **Standalone live files.** `.three` / `.sketch` → `live` viewer, kind from extension.
   Test in `test/livePane.test.tsx`.
5. **Entry budget.** `packages/ui/scripts/check-entry-size.mjs` run by `bin/build` after the UI
   build; reads `dist/app/index.html`, sums the entry script's gzip size, fails over budget.
6. **Gallery and docs.** `examples/README.md` gallery, `examples/charts.md`, `examples/maps.md`,
   `examples/data/*`, standalone files, README section; e2e: new examples render without console
   errors, a chart canvas and a map svg appear.
