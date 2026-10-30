// Sticky UI preferences, persisted to localStorage under `leaf.ui`.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LINK_SCHEMES } from '@leaf/protocol';

export type Theme = 'github' | 'glass' | 'card' | 'paper';
export type Appearance = 'light' | 'dark' | 'auto';

export const THEMES: readonly Theme[] = ['github', 'glass', 'card', 'paper'];
export const TEXT_MIN = 70;
export const TEXT_MAX = 160;
/** Sidebar widths in CSS pixels; the server enforces the same range. */
export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 260;
export type Side = 'tree' | 'outline';
/** The blame column's width range, in CSS pixels. */
export const BLAME_MIN = 160;
export const BLAME_MAX = 480;

export type UiState = {
  treeOpen: boolean;
  outlineOpen: boolean;
  numbering: boolean;
  theme: Theme;
  appearance: Appearance;
  textPct: number;
  expandedDirs: string[];
  treeWidth: number;
  outlineWidth: number;
  /** The last commit line in the file header. */
  showGit: boolean;
  setShowGit(v: boolean): void;
  /** Git blame beside the lines of code and markdown files. */
  blame: boolean;
  /** The blame annotation column's width in CSS pixels. */
  blameWidth: number;
  setBlame(v: boolean): void;
  /** Clamped to BLAME_MIN..BLAME_MAX. */
  setBlameWidth(px: number): void;
  /** The kinds of link (URL schemes) the app window hands to other apps. */
  linkSchemes: string[];
  setLinkSchemes(v: string[]): void;
  /** Where the app opens a file or folder: a new window, or a new tab of the front one. */
  openIn: 'tab' | 'window';
  setOpenIn(v: 'tab' | 'window'): void;
  /** Reopen the windows and tabs that were open when the app quit. */
  reopenTabs: boolean;
  setReopenTabs(v: boolean): void;
  setTreeOpen(v: boolean): void;
  setOutlineOpen(v: boolean): void;
  setNumbering(v: boolean): void;
  setTheme(v: Theme): void;
  setAppearance(v: Appearance): void;
  bumpText(delta: -10 | 0 | 10): void;
  setExpandedDirs(dirs: string[]): void;
  /** Clamped to SIDEBAR_MIN..SIDEBAR_MAX. */
  setSidebarWidth(side: Side, px: number): void;
};

export const UI_DEFAULTS = {
  treeOpen: true,
  outlineOpen: true,
  numbering: false,
  theme: 'github' as Theme,
  appearance: 'auto' as Appearance,
  textPct: 100,
  expandedDirs: [] as string[],
  treeWidth: SIDEBAR_DEFAULT,
  outlineWidth: SIDEBAR_DEFAULT,
  showGit: true,
  blame: false,
  blameWidth: 220,
  linkSchemes: [...DEFAULT_LINK_SCHEMES],
  openIn: 'window' as 'tab' | 'window',
  reopenTabs: false,
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      ...UI_DEFAULTS,
      setTreeOpen: (treeOpen) => set({ treeOpen }),
      setLinkSchemes: (linkSchemes) => set({ linkSchemes }),
      setOpenIn: (openIn) => set({ openIn }),
      setReopenTabs: (reopenTabs) => set({ reopenTabs }),
      setShowGit: (showGit) => set({ showGit }),
      setBlame: (blame) => set({ blame }),
      setBlameWidth: (px) =>
        set({ blameWidth: Math.round(Math.min(BLAME_MAX, Math.max(BLAME_MIN, px))) }),
      setOutlineOpen: (outlineOpen) => set({ outlineOpen }),
      setNumbering: (numbering) => set({ numbering }),
      setTheme: (theme) => set({ theme }),
      setAppearance: (appearance) => set({ appearance }),
      bumpText: (delta) =>
        set((s) => ({
          textPct: delta === 0 ? 100 : Math.min(TEXT_MAX, Math.max(TEXT_MIN, s.textPct + delta)),
        })),
      setExpandedDirs: (expandedDirs) => set({ expandedDirs }),
      setSidebarWidth: (side, px) => {
        const w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)));
        set(side === 'tree' ? { treeWidth: w } : { outlineWidth: w });
      },
    }),
    { name: 'leaf.ui' },
  ),
);

/** Applies theme, appearance, and text scale to an element (normally <html>). */
export function applyTheme(
  root: HTMLElement,
  theme: Theme | 'native',
  appearance: Appearance,
  textPct = 100,
): void {
  const dark =
    appearance === 'dark' ||
    (appearance === 'auto' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = theme;
  root.dataset.appearance = dark ? 'dark' : 'light';
  root.style.setProperty('--leaf-text-scale', String(textPct / 100));
}

/**
 * Keeps this page's settings in step with other tabs of the app: each tab is its own
 * page, so when one saves a change (text size, appearance, the sidebars), the others
 * take it from storage. Returns the unsubscribe.
 */
export function followOtherTabs(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === 'leaf.ui') void useUi.persist.rehydrate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
