// A pinch on an element zooms it, around the fingers; a two-finger scroll is left to
// the page, so a document never gets stuck on a block. Trackpads report a pinch as
// ctrl+wheel (Chromium, Firefox) or as gesture events (WebKit: Safari, the app).
import { useEffect, type RefObject } from 'react';
import { gestureFactor } from './wheel.js';

export type Zoom = (point: { x: number; y: number }, factor: number) => void;

export function usePinch(ref: RefObject<Element | null>, zoom: Zoom, enabled = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const at = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: (e.clientX || r.left) - r.left, y: (e.clientY || r.top) - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // A trackpad pinch sends small steps; a mouse's ctrl+wheel big ones. Cap each step.
      zoom(at(e), Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.01))));
    };
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    let last = 1;
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (e.type === 'gesturestart') last = 1;
      if (e.type !== 'gesturechange') return;
      zoom(at(g), gestureFactor(g.scale, last));
      last = g.scale;
    };
    el.addEventListener('wheel', onWheel as EventListener, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
      el.addEventListener(t, onGesture, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel as EventListener);
      for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
        el.removeEventListener(t, onGesture);
    };
  }, [ref, zoom, enabled]);
}
