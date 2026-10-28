// Find in the rendered document: text ranges for a query, painted with the CSS
// Custom Highlight API so the DOM React owns is never touched.

/** Text inside these is chrome (copy buttons, labels), not the document. */
const SKIP = 'button, script, style, [aria-hidden="true"], .leaf-block-tools, .leaf-toolbox';

/** Every case-insensitive occurrence of `q` inside a single text node under `root`. */
export function findMatches(root: Element, q: string): Range[] {
  const needle = q.toLowerCase();
  if (!needle) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const hay = (n.nodeValue ?? '').toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

type HighlightRegistry = Map<string, unknown>;
const registry = (): HighlightRegistry | null =>
  (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights ?? null;

/** Match colors. Added at runtime because the build's CSS minifier does not know
 *  ::highlight() and warns on every build; the browser does. */
const STYLES = `::highlight(leaf-find) { background-color: rgba(255, 213, 0, 0.38); color: inherit; }
::highlight(leaf-find-current) { background-color: rgb(255, 150, 0); color: #000; }`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('leaf-find-styles')) return;
  const style = document.createElement('style');
  style.id = 'leaf-find-styles';
  style.textContent = STYLES;
  document.head.append(style);
}

/** Paints all matches and the current one; a no-op where highlights are unsupported. */
export function paintMatches(ranges: Range[], current: number): void {
  ensureStyles();
  const reg = registry();
  const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !H) return;
  reg.set('leaf-find', new H(...ranges));
  const cur = ranges[current];
  if (cur) reg.set('leaf-find-current', new H(cur));
  else reg.delete('leaf-find-current');
}

export function clearMatches(): void {
  const reg = registry();
  reg?.delete('leaf-find');
  reg?.delete('leaf-find-current');
}

/** Scrolls `scroller` so the range sits a third of the way down. */
export function revealRange(range: Range, scroller: HTMLElement | null): void {
  if (!scroller) return;
  if (typeof range.getBoundingClientRect !== 'function') {
    range.startContainer.parentElement?.scrollIntoView?.({ block: 'center' });
    return;
  }
  const r = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const offset = r.top - box.top - scroller.clientHeight / 3;
  if (r.top < box.top + 40 || r.bottom > box.bottom - 60)
    scroller.scrollBy?.({ top: offset, behavior: 'smooth' });
}
