// The drag handle on a sidebar's inner edge. Drag, arrow keys, or double-click to reset.
import { useRef } from 'react';
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, useUi, type Side } from '../store/ui.js';

const STEP = 16;

export function Resizer({ side }: { side: Side }) {
  const width = useUi((s) => (side === 'tree' ? s.treeWidth : s.outlineWidth));
  const setWidth = useUi((s) => s.setSidebarWidth);
  // The tree grows to the right, the outline to the left.
  const dir = side === 'tree' ? 1 : -1;
  const drag = useRef<{ x: number; w: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: width };
    document.documentElement.dataset.resizing = '';
    const move = (ev: PointerEvent) => {
      if (drag.current) setWidth(side, drag.current.w + dir * (ev.clientX - drag.current.x));
    };
    const up = (ev: PointerEvent) => {
      move(ev);
      drag.current = null;
      delete document.documentElement.dataset.resizing;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidth(side, width + (e.key === 'ArrowRight' ? STEP : -STEP) * dir);
    }
  };

  return (
    <div
      className={`leaf-resizer leaf-resizer-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'tree' ? 'Resize files' : 'Resize outline'}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setWidth(side, SIDEBAR_DEFAULT)}
    />
  );
}
