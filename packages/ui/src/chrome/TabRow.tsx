// The row of tabs under the title row: square cells, the active one on the document's
// color with an accent line. Each tab is named by its path, shortened to fit.
import { useRef } from 'react';
import { iconFor } from '../components/fileIcon.js';
import { shortenPath } from '../components/shortenPath.js';
import type { Bridge, TabInfo } from './bridge.js';
import { TAB_WIDTH, tabDragHandlers } from './useTabDrag.js';

let canvas: CanvasRenderingContext2D | null | undefined;
/** Whether a label fits a tab, measured in the tab's font. */
export function labelFits(s: string): boolean {
  canvas ??= document.createElement('canvas').getContext?.('2d') ?? null;
  if (!canvas) return true;
  canvas.font = '11.5px ui-monospace, Menlo, monospace';
  return canvas.measureText(s).width <= TAB_WIDTH - 60;
}

type Props = {
  bridge: Bridge;
  tabs: TabInfo[];
  /** Where a tab dragged over this window would land, if one is. */
  dropAt: number | null;
  fits?: (s: string) => boolean;
};

export function TabRow({ bridge, tabs, dropAt, fits = labelFits }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const lefts = () =>
    [...(row.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].map(
      (t) => t.offsetLeft,
    );
  return (
    <div className="leaf-tabs" role="tablist" ref={row}>
      {tabs.map((t, i) => {
        const Icon = iconFor({ kind: t.kind === 'folder' ? 'dir' : 'file', name: t.name });
        return (
          <div key={t.id} className="leaf-tab-slot">
            {dropAt === i && <span className="leaf-tab-drop" aria-hidden="true" />}
            <div
              role="tab"
              tabIndex={0}
              aria-selected={t.active}
              title={t.path}
              className={`leaf-tab ${t.active ? 'leaf-tab-on' : ''}`}
              onKeyDown={(e) => e.key === 'Enter' && bridge.select(t.id)}
              {...tabDragHandlers(bridge, t, 'tab', lefts)}
            >
              <Icon size={14} className="leaf-tab-icon" />
              <span className="leaf-tab-label">{shortenPath(t.label, fits)}</span>
              <button
                type="button"
                className="leaf-tab-close"
                aria-label="Close tab"
                title="Close tab (⌘W)"
                data-close=""
                onClick={() => bridge.close(t.id)}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {dropAt !== null && dropAt >= tabs.length && (
        <span className="leaf-tab-drop" aria-hidden="true" />
      )}
      <button
        type="button"
        className="leaf-tab-new"
        aria-label="New tab"
        title="New tab (⌘T)"
        onClick={() => bridge.newTab()}
      >
        +
      </button>
    </div>
  );
}
