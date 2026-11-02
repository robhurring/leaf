// Strokes drawn on the Stage, kept for the session only (never persisted).
import { create } from 'zustand';
import type { InkColor } from './stage.js';

export type Stroke = {
  id: string;
  docPath: string;
  blockHash: string;
  points: [number, number][];
  color: InkColor;
  width: number;
  sticky: boolean;
  createdAt: number;
  stale?: boolean;
  /** Who drew it, for a stroke that came over the relay; the page's own strokes have none. */
  peer?: string;
};

export const INK_FADE_START_MS = 1500;
export const INK_GONE_MS = 3000;

const on = (k: Stroke, docPath: string, blockHash: string, remote: boolean) =>
  k.docPath === docPath && k.blockHash === blockHash && !!k.peer === remote;

/** Without the block's strokes of one kind (the page's own, or the relay's). */
function dropAll(strokes: Stroke[], docPath: string, blockHash: string, remote: boolean) {
  return { strokes: strokes.filter((k) => !on(k, docPath, blockHash, remote)) };
}

/** Without the block's latest stroke of one kind. */
function dropLast(strokes: Stroke[], docPath: string, blockHash: string, remote: boolean) {
  let last = -1;
  strokes.forEach((k, i) => {
    if (on(k, docPath, blockHash, remote)) last = i;
  });
  return last < 0 ? { strokes } : { strokes: strokes.filter((_, i) => i !== last) };
}

type State = {
  strokes: Stroke[];
  /** Block hashes currently rendered per document (ref-counted), so stale strokes can be told apart. */
  live: Record<string, Record<string, number>>;
  trackBlock(docPath: string, blockHash: string): () => void;
  isLive(docPath: string, blockHash: string): boolean;
  add(stroke: Stroke): void;
  clear(docPath: string, blockHash: string): void;
  /** Takes back the block's latest stroke of the page's own. */
  undo(docPath: string, blockHash: string): void;
  /** A stroke from the relay; one already here (by id) is not added again. */
  addRemote(stroke: Stroke): void;
  /** Takes back the block's latest stroke from the relay. */
  undoRemote(docPath: string, blockHash: string): void;
  /** Drops the block's strokes from the relay. */
  clearRemote(docPath: string, blockHash: string): void;
  /** Drops every stroke from the relay on a document, before the relay sends its kept ones. */
  clearRemoteFor(docPath: string): void;
  /** Drops non-sticky strokes older than INK_GONE_MS. Returns how many remain. */
  expire(now: number): number;
  /** Sticky strokes for `docPath` with a different block hash become stale (the diagram changed). */
  markStale(docPath: string, liveHashes: string[]): void;
};

export const useAnnotations = create<State>((set, get) => ({
  strokes: [],
  live: {},
  trackBlock: (docPath, blockHash) => {
    const bump = (delta: number) =>
      set((s) => {
        const doc = { ...(s.live[docPath] ?? {}) };
        const next = (doc[blockHash] ?? 0) + delta;
        if (next > 0) doc[blockHash] = next;
        else delete doc[blockHash];
        return { live: { ...s.live, [docPath]: doc } };
      });
    bump(1);
    get().markStale(docPath, Object.keys(get().live[docPath] ?? {}));
    return () => {
      bump(-1);
      get().markStale(docPath, Object.keys(get().live[docPath] ?? {}));
    };
  },
  isLive: (docPath, blockHash) => (get().live[docPath]?.[blockHash] ?? 0) > 0,
  add: (stroke) => set((s) => ({ strokes: [...s.strokes, stroke] })),
  // The page's own undo and clear touch only its own strokes; the relay's own do the rest.
  clear: (docPath, blockHash) => set((s) => dropAll(s.strokes, docPath, blockHash, false)),
  undo: (docPath, blockHash) => set((s) => dropLast(s.strokes, docPath, blockHash, false)),
  addRemote: (stroke) =>
    set((s) =>
      s.strokes.some((k) => k.id === stroke.id)
        ? s
        : // Fading runs on this page's clock, not the drawer's.
          { strokes: [...s.strokes, { ...stroke, createdAt: Date.now() }] },
    ),
  clearRemote: (docPath, blockHash) => set((s) => dropAll(s.strokes, docPath, blockHash, true)),
  clearRemoteFor: (docPath) =>
    set((s) => ({ strokes: s.strokes.filter((k) => !(k.peer && k.docPath === docPath)) })),
  undoRemote: (docPath, blockHash) => set((s) => dropLast(s.strokes, docPath, blockHash, true)),
  expire: (now) => {
    set((s) => ({ strokes: s.strokes.filter((k) => k.sticky || now - k.createdAt < INK_GONE_MS) }));
    return get().strokes.length;
  },
  markStale: (docPath, liveHashes) =>
    set((s) => ({
      strokes: s.strokes.map((k) =>
        k.docPath === docPath && k.sticky ? { ...k, stale: !liveHashes.includes(k.blockHash) } : k,
      ),
    })),
}));

export const strokesFor = (strokes: Stroke[], docPath: string, blockHash: string) =>
  strokes.filter((k) => k.docPath === docPath && k.blockHash === blockHash);
