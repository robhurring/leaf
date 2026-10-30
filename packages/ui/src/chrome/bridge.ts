// The chrome's line to the app: the window's tabs, the active tab's state, and the
// commands its buttons send. The one place the chrome touches Tauri.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { TopBarProps } from '../components/TopBar.js';

export type TabInfo = {
  id: string;
  /** The tab's name: its root under `~`, plus the document a cloned tab opened on. */
  label: string;
  /** The full path, for the tooltip. */
  path: string;
  kind: 'folder' | 'file';
  /** The root's file name, for its icon. */
  name: string;
  active: boolean;
};

/** What the active tab's reader shows in the title row. */
export type TabState = Pick<
  TopBarProps,
  | 'title'
  | 'path'
  | 'treeAvailable'
  | 'treeOpen'
  | 'outlineAvailable'
  | 'outlineOpen'
  | 'numbering'
  | 'textPct'
  | 'theme'
  | 'appearance'
  | 'status'
> & { canBack: boolean; canForward: boolean };

/** The window a dragged tab is over, and where in its row it would land. */
export type Hover = { window: string; index: number } | null;

export type Bridge = {
  windowLabel(): string;
  tabs(): Promise<TabInfo[]>;
  select(id: string): void;
  close(id: string): void;
  newTab(): void;
  /** A reader command (goBack, openPalette, …) for the active tab. */
  command(name: string, arg?: unknown): void;
  reorder(id: string, index: number): void;
  /** The pointer, in screen points, while a tab is dragged off its row; `first` starts the drag. */
  dragMove(id: string, label: string, x: number, y: number, first: boolean): void;
  dragEnd(id: string, x: number, y: number): void;
  /** The app's own Appearance menu (Light, Dark, System, Settings…) under the button. */
  appearanceMenu(): void;
  onTabs(fn: () => void): () => void;
  onHover(fn: (h: Hover) => void): () => void;
  onTabState(fn: (s: TabState) => void): () => void;
};

const fire = (cmd: string, args?: Record<string, unknown>) =>
  void invoke(cmd, args).catch(() => {});

/** Subscribes now, unsubscribes whenever asked (even before the listener is in place). */
function on<T>(event: string, fn: (payload: T) => void): () => void {
  let off: (() => void) | null = null;
  let gone = false;
  void listen<T>(event, (e) => fn(e.payload)).then((u) => (gone ? u() : (off = u)));
  return () => {
    gone = true;
    off?.();
  };
}

export const tauriBridge: Bridge = {
  windowLabel: () => (window as { __LEAF_CHROME__?: string }).__LEAF_CHROME__ ?? '',
  tabs: () => invoke<TabInfo[]>('leaf_tabs'),
  select: (id) => fire('leaf_select_tab', { id }),
  close: (id) => fire('leaf_close_tab', { id }),
  newTab: () => fire('leaf_new_tab'),
  command: (name, arg) => fire('leaf_tab_command', { name, arg: arg ?? null }),
  reorder: (id, index) => fire('leaf_reorder', { tab: id, index }),
  dragMove: (id, label, x, y, first) => fire('leaf_drag_move', { tab: id, label, x, y, first }),
  dragEnd: (id, x, y) => fire('leaf_drag_end', { tab: id, x, y }),
  appearanceMenu: () => fire('leaf_appearance_menu'),
  onTabs: (fn) => on('leaf://tabs', fn),
  onHover: (fn) => on<Hover>('leaf://hover', fn),
  onTabState: (fn) => on<TabState>(`leaf://tab-state/${tauriBridge.windowLabel()}`, fn),
};
