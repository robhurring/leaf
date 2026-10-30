// When a pointer press on a tab (or the leaf mark) becomes a drag out of the row, and
// where a dragged tab lands among others.

type Point = { x: number; y: number };

/**
 * Whether the pointer has taken the tab off its row: a tab once it leaves the row's
 * height by 30px or goes past either end (sideways along the row is reordering); the
 * leaf mark, which has no row, after 8px any way.
 */
export function dragged(kind: 'tab' | 'mark', start: Point, now: Point, width: number): boolean {
  if (kind === 'mark') return Math.hypot(now.x - start.x, now.y - start.y) > 8;
  return Math.abs(now.y - start.y) > 30 || now.x < 0 || now.x > width;
}

/** The position a tab dropped at `x` takes: before the first tab whose middle is right of it. */
export function dropIndex(x: number, lefts: number[], width: number): number {
  const i = lefts.findIndex((left) => left + width / 2 > x);
  return i === -1 ? lefts.length : i;
}
