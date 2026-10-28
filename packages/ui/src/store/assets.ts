// Assets (images, media) for a source that has no HTTP path: fetched over the
// socket as base64 and turned into object URLs. With `rawUrls` the server's
// /raw endpoint is used instead and this store stays empty.
import { create } from 'zustand';
import type { ClientMessage } from '@leaf/protocol';

/** A 1x1 transparent gif, shown while the bytes are on their way. */
export const PENDING_ASSET =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

type AssetsState = {
  urls: Record<string, string>;
  attach(send: (msg: ClientMessage) => void): void;
  /** Asks the source for `path` once; later `store` calls fill `urls`. */
  request(path: string): void;
  store(path: string, base64: string, mime: string): void;
  reset(): void;
};

let send: ((msg: ClientMessage) => void) | null = null;
const pending = new Set<string>();
let counter = 0;

export function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const useAssets = create<AssetsState>((set, get) => ({
  urls: {},
  attach(fn) {
    send = fn;
  },
  request(path) {
    if (pending.has(path) || get().urls[path] !== undefined || !send) return;
    pending.add(path);
    send({ type: 'read', path, id: `asset-${++counter}` });
  },
  store(path, base64, mime) {
    pending.delete(path);
    const prev = get().urls[path];
    if (prev) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(base64ToBlob(base64, mime));
    set((s) => ({ urls: { ...s.urls, [path]: url } }));
  },
  reset() {
    for (const url of Object.values(get().urls)) URL.revokeObjectURL(url);
    pending.clear();
    set({ urls: {} });
  },
}));
