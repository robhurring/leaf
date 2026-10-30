// A press on a tab (or the leaf mark): a click selects it, sideways along the row
// reorders it, and off the row it is dragged out with a ghost under the pointer.
import type { PointerEvent } from 'react';
import type { Bridge, TabInfo } from './bridge.js';
import { dragged, dropIndex } from './drag.js';

export const TAB_WIDTH = 190;

export function tabDragHandlers(
  bridge: Bridge,
  tab: TabInfo,
  kind: 'tab' | 'mark',
  order: () => number[] = () => [],
) {
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0 || (e.target as HTMLElement).closest('[data-close]')) return;
      const el = e.currentTarget;
      el.setPointerCapture?.(e.pointerId);
      const start = { x: e.clientX, y: e.clientY };
      let out = false;
      let last = { x: e.screenX, y: e.screenY };
      let index = -1;
      const end = () => {
        el.onpointermove = el.onpointerup = el.onlostpointercapture = null;
        el.classList.remove('leaf-tab-dragging');
        if (out) bridge.dragEnd(tab.id, last.x, last.y);
        else if (kind === 'tab') bridge.select(tab.id);
      };
      el.onpointermove = (m) => {
        last = { x: m.screenX, y: m.screenY };
        const first = !out;
        out ||= dragged(kind, start, { x: m.clientX, y: m.clientY }, innerWidth);
        if (out) {
          el.classList.add('leaf-tab-dragging');
          bridge.dragMove(tab.id, tab.label, m.screenX, m.screenY, first);
        } else if (kind === 'tab') {
          const to = dropIndex(m.clientX, order(), TAB_WIDTH);
          if (to !== index) {
            index = to;
            bridge.reorder(tab.id, to);
          }
        }
      };
      el.onpointerup = (u) => {
        last = { x: u.screenX, y: u.screenY };
        end();
      };
      // A drag the window loses mid-way lands where the pointer was last seen.
      el.onlostpointercapture = () => el.onpointerup && end();
    },
  };
}
