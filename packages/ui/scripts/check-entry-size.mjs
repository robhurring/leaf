// Opening leaf stays fast: fails the build when the scripts and styles the page loads
// before anything else grow past the budget. Libraries belong in lazy chunks, loaded
// the first time a document needs them.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// gzipped bytes; raise it on purpose, with a reason, never to make a build pass.
const BUDGET = { js: 245_000, css: 16_000 };

const dist = join(import.meta.dirname, '..', 'dist', 'app');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(js|css))"/g)];
const size = { js: 0, css: 0 };
for (const [, path, kind] of assets) size[kind] += gzipSync(readFileSync(join(dist, path))).length;

const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
let over = false;
for (const kind of ['js', 'css']) {
  const ok = size[kind] <= BUDGET[kind];
  over ||= !ok;
  console.log(
    `startup ${kind}: ${kb(size[kind])} gzipped (budget ${kb(BUDGET[kind])})${ok ? '' : '  OVER'}`,
  );
}
if (over) {
  console.error(
    'The page loads too much before anything else. Move the new library behind a lazy import.',
  );
  process.exit(1);
}
