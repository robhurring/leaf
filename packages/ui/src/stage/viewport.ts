// Pure pan/zoom math for the Stage: a scale plus a translation applied to the
// content layer. View coordinates are pixels inside the viewport element.
export type Transform = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export type Viewport = {
  get(): Transform;
  set(t: Transform): void;
  panBy(dx: number, dy: number): void;
  /** Multiplies the scale by `factor`, keeping the content under `point` fixed. */
  zoomAt(point: Point, factor: number): void;
  fit(contentW: number, contentH: number, viewW: number, viewH: number, margin?: number): void;
  /** The content at 1:1, its middle in the middle of the view. */
  actualSize(contentW: number, contentH: number, viewW: number, viewH: number): void;
  reset(): void;
  toContent(point: Point): Point;
  subscribe(fn: (t: Transform) => void): () => void;
};

const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function createViewport(initial: Transform = { scale: 1, x: 0, y: 0 }): Viewport {
  let t = { ...initial };
  const listeners = new Set<(t: Transform) => void>();
  const emit = () => {
    for (const fn of listeners) fn(t);
  };
  return {
    get: () => ({ ...t }),
    set(next) {
      t = { ...next, scale: clamp(next.scale) };
      emit();
    },
    panBy(dx, dy) {
      t = { ...t, x: t.x + dx, y: t.y + dy };
      emit();
    },
    zoomAt(point, factor) {
      const scale = clamp(t.scale * factor);
      const k = scale / t.scale;
      // The content point under the cursor stays put: p = c*s + x  ⇒  x' = p - (p - x)*k
      t = { scale, x: point.x - (point.x - t.x) * k, y: point.y - (point.y - t.y) * k };
      emit();
    },
    fit(contentW, contentH, viewW, viewH, margin = 24) {
      if (contentW <= 0 || contentH <= 0 || viewW <= 0 || viewH <= 0) return;
      const scale = clamp(
        Math.min((viewW - margin * 2) / contentW, (viewH - margin * 2) / contentH),
      );
      t = { scale, x: (viewW - contentW * scale) / 2, y: (viewH - contentH * scale) / 2 };
      emit();
    },
    actualSize(contentW, contentH, viewW, viewH) {
      t = { scale: 1, x: (viewW - contentW) / 2, y: (viewH - contentH) / 2 };
      emit();
    },
    reset() {
      t = { scale: 1, x: 0, y: 0 };
      emit();
    },
    toContent(point) {
      return { x: (point.x - t.x) / t.scale, y: (point.y - t.y) / t.scale };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
