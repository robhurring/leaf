// URL ↔ { path, slug }. Path strategy only: /docs/guide.md#anchor under `base`.
import { safeDecode } from './render/paths.js';

export type Location = { path: string; slug: string };

export type Router = {
  current(): Location;
  push(path: string, slug?: string): void;
  replace(path: string, slug?: string): void;
  subscribe(fn: (loc: Location) => void): () => void;
  back(): void;
  forward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  /** Fires when what back and forward can reach changes. */
  onHistory(fn: () => void): () => void;
};

// Each entry leaf creates carries its position in history.state, so back and forward
// know where they stand without the browser saying. `top` is the newest reachable entry;
// it lives in the session so a reload keeps the forward stack.
type Entry = { leaf: number };
const TOP_KEY = 'leaf.historyTop';
const indexOf = (state: unknown) =>
  typeof (state as Entry | null)?.leaf === 'number' ? (state as Entry).leaf : null;
const readTop = () => {
  try {
    return Number(sessionStorage.getItem(TOP_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeTop = (n: number) => {
  try {
    sessionStorage.setItem(TOP_KEY, String(n));
  } catch {
    // Private windows: the forward stack just won't survive a reload.
  }
};

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function createRouter(base = ''): Router {
  const prefix = base.replace(/\/+$/, '');
  const url = (path: string, slug?: string) =>
    `${prefix}/${encodePath(path)}${slug ? `#${slug}` : ''}`;
  const current = (): Location => {
    let pathname = window.location.pathname;
    if (prefix && pathname.startsWith(prefix)) pathname = pathname.slice(prefix.length);
    const path = safeDecode(pathname.replace(/^\/+/, '').replace(/\/+$/, ''));
    return { path, slug: window.location.hash.replace(/^#/, '') };
  };
  let index = indexOf(window.history.state) ?? 0;
  if (indexOf(window.history.state) === null)
    window.history.replaceState({ leaf: 0 } satisfies Entry, '');
  let top = Math.max(index, index === 0 ? 0 : readTop());
  writeTop(top);
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((fn) => fn());
  window.addEventListener('popstate', (e) => {
    const at = indexOf(e.state);
    if (at === null) return;
    index = at;
    top = Math.max(top, at);
    changed();
  });
  return {
    current,
    push(path, slug) {
      index += 1;
      top = index;
      writeTop(top);
      window.history.pushState({ leaf: index } satisfies Entry, '', url(path, slug));
      changed();
    },
    replace(path, slug) {
      window.history.replaceState({ leaf: index } satisfies Entry, '', url(path, slug));
    },
    subscribe(fn) {
      const handler = () => fn(current());
      window.addEventListener('popstate', handler);
      return () => window.removeEventListener('popstate', handler);
    },
    back() {
      if (index > 0) window.history.back();
    },
    forward() {
      if (index < top) window.history.forward();
    },
    canGoBack: () => index > 0,
    canGoForward: () => index < top,
    onHistory(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
