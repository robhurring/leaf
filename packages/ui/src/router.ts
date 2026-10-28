// URL ↔ { path, slug }. Path strategy only: /docs/guide.md#anchor under `base`.
import { safeDecode } from './render/paths.js';

export type Location = { path: string; slug: string };

export type Router = {
  current(): Location;
  push(path: string, slug?: string): void;
  replace(path: string, slug?: string): void;
  subscribe(fn: (loc: Location) => void): () => void;
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
  return {
    current,
    push(path, slug) {
      window.history.pushState(null, '', url(path, slug));
    },
    replace(path, slug) {
      window.history.replaceState(null, '', url(path, slug));
    },
    subscribe(fn) {
      const handler = () => fn(current());
      window.addEventListener('popstate', handler);
      return () => window.removeEventListener('popstate', handler);
    },
  };
}
