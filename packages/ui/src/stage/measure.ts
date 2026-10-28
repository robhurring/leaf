// Sizing fixes for pictures on the Stage. Mermaid emits `width="100%"` with a
// max-width, which collapses inside the Stage's max-content layer; give such an
// svg its viewBox size so fit() measures the real diagram.
export function sizeToViewBox(svg: SVGSVGElement): void {
  const width = svg.getAttribute('width') ?? '';
  if (width && !width.endsWith('%')) return;
  const vb = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length !== 4 || !(vb[2]! > 0) || !(vb[3]! > 0)) return;
  svg.style.width = `${vb[2]}px`;
  svg.style.height = `${vb[3]}px`;
  svg.style.maxWidth = 'none';
}

/** Applies `sizeToViewBox` to every svg under `root`. */
export function sizeSvgs(root: ParentNode): void {
  for (const el of root.querySelectorAll('svg')) sizeToViewBox(el);
}

/** The content's size once it is ready to measure, or null while a viewer is still busy or empty. */
export function contentSize(layer: HTMLElement): { w: number; h: number } | null {
  if (layer.querySelector('[aria-busy="true"]')) return null;
  const content = layer.firstElementChild as HTMLElement | null;
  const w = content?.scrollWidth || layer.scrollWidth;
  const h = content?.scrollHeight || layer.scrollHeight;
  return w > 0 && h > 0 ? { w, h } : null;
}
