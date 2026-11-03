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
/** A stroke in progress whose frames stopped this long ago is taken to be abandoned. */
export const INK_DRAFT_STALE_MS = 3000;

/** Another peer's stroke still being drawn: the points so far, and when the last frame came. */
export type Draft = Stroke & { peer: string; at: number };
const draftKey = (peer: string, id: string) => `${peer}/${id}`;

/** On the block, and drawn by `peer` (the page's own strokes when `undefined`). */
const on = (k: Stroke, docPath: string, blockHash: string, peer: string | undefined) =>
  k.docPath === docPath && k.blockHash === blockHash && k.peer === peer;

/** Without the block's strokes by one peer. */
function dropAll(strokes: Stroke[], docPath: string, blockHash: string, peer?: string) {
  return { strokes: strokes.filter((k) => !on(k, docPath, blockHash, peer)) };
}

/** Without the block's latest stroke by one peer. */
function dropLast(strokes: Stroke[], docPath: string, blockHash: string, peer?: string) {
  let last = -1;
  strokes.forEach((k, i) => {
    if (on(k, docPath, blockHash, peer)) last = i;
  });
  return last < 0 ? { strokes } : { strokes: strokes.filter((_, i) => i !== last) };
}

type State = {
  strokes: Stroke[];
  /** Other peers' strokes still being drawn, by peer and stroke id. */
  drafts: Record<string, Draft>;
  /** Block hashes currently rendered per document (ref-counted), so stale strokes can be told apart. */
  live: Record<string, Record<string, number>>;
  trackBlock(docPath: string, blockHash: string): () => void;
  isLive(docPath: string, blockHash: string): boolean;
  add(stroke: Stroke): void;
  clear(docPath: string, blockHash: string): void;
  /** Takes back the block's latest stroke of the page's own. */
  undo(docPath: string, blockHash: string): void;
  /** A finished stroke from the relay, ending its draft; one already here (by id) is not added again. */
  addRemote(stroke: Stroke & { peer: string }): void;
  /** More of a peer's stroke in progress: the points since its last frame. */
  draft(peer: string, stroke: Stroke): void;
  /** Takes back the block's latest stroke by a peer. */
  undoRemote(docPath: string, blockHash: string, peer: string): void;
  /** Drops the block's strokes by a peer. */
  clearRemote(docPath: string, blockHash: string, peer: string): void;
  /** Drops every stroke and draft from the relay on a document, before the relay sends its kept ones. */
  clearRemoteFor(docPath: string): void;
  /** Drops non-sticky strokes older than INK_GONE_MS and drafts idle for INK_DRAFT_STALE_MS.
   * Returns how many strokes remain. */
  expire(now: number): number;
  /** Sticky strokes for `docPath` with a different block hash become stale (the diagram changed). */
  markStale(docPath: string, liveHashes: string[]): void;
};

export const useAnnotations = create<State>((set, get) => ({
  strokes: [],
  drafts: {},
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
  // The page's own undo and clear touch only its own strokes; each peer's do only that peer's.
  clear: (docPath, blockHash) => set((s) => dropAll(s.strokes, docPath, blockHash)),
  undo: (docPath, blockHash) => set((s) => dropLast(s.strokes, docPath, blockHash)),
  addRemote: (stroke) =>
    set((s) => {
      const drafts = { ...s.drafts };
      delete drafts[draftKey(stroke.peer, stroke.id)];
      return s.strokes.some((k) => k.id === stroke.id)
        ? { drafts }
        : // Fading runs on this page's clock, not the drawer's.
          { drafts, strokes: [...s.strokes, { ...stroke, createdAt: Date.now() }] };
    }),
  draft: (peer, stroke) =>
    set((s) => {
      const key = draftKey(peer, stroke.id);
      const before = s.drafts[key];
      const points = before ? [...before.points, ...stroke.points] : stroke.points;
      return { drafts: { ...s.drafts, [key]: { ...stroke, points, peer, at: Date.now() } } };
    }),
  clearRemote: (docPath, blockHash, peer) =>
    set((s) => dropAll(s.strokes, docPath, blockHash, peer)),
  clearRemoteFor: (docPath) =>
    set((s) => ({
      strokes: s.strokes.filter((k) => !(k.peer && k.docPath === docPath)),
      drafts: Object.fromEntries(Object.entries(s.drafts).filter(([, d]) => d.docPath !== docPath)),
    })),
  undoRemote: (docPath, blockHash, peer) =>
    set((s) => dropLast(s.strokes, docPath, blockHash, peer)),
  expire: (now) => {
    set((s) => {
      const stale = Object.keys(s.drafts).filter(
        (k) => now - s.drafts[k]!.at >= INK_DRAFT_STALE_MS,
      );
      const drafts = { ...s.drafts };
      for (const k of stale) delete drafts[k];
      return {
        strokes: s.strokes.filter((k) => k.sticky || now - k.createdAt < INK_GONE_MS),
        drafts: stale.length ? drafts : s.drafts,
      };
    });
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

export const draftsFor = (drafts: Record<string, Draft>, docPath: string, blockHash: string) =>
  Object.values(drafts).filter((d) => d.docPath === docPath && d.blockHash === blockHash);
