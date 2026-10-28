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
};

export const INK_FADE_START_MS = 4000;
export const INK_GONE_MS = 8000;

type State = {
  strokes: Stroke[];
  /** Block hashes currently rendered per document (ref-counted), so stale strokes can be told apart. */
  live: Record<string, Record<string, number>>;
  trackBlock(docPath: string, blockHash: string): () => void;
  isLive(docPath: string, blockHash: string): boolean;
  add(stroke: Stroke): void;
  clear(docPath: string, blockHash: string): void;
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
  clear: (docPath, blockHash) =>
    set((s) => ({
      strokes: s.strokes.filter((k) => !(k.docPath === docPath && k.blockHash === blockHash)),
    })),
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
