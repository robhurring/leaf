// Where the other peers' pointers are on the canvases of a share, as the relay last
// said. Kept apart from the documents store: pointers move many times a second.
import { create } from 'zustand';
import type { PointerAt } from '@leaf/protocol';

/** A pointer that hasn't moved for this long is taken to have gone. */
export const POINTER_STALE_MS = 5000;

type State = {
  pointers: Record<string, PointerAt & { at: number }>;
  /** A peer's pointer moved; without one, it left the canvas. */
  move(peer: string, pointer: PointerAt | undefined): void;
  /** Drops the pointers that haven't moved for POINTER_STALE_MS. */
  sweep(now: number): void;
  clear(): void;
};

export const usePointers = create<State>((set) => ({
  pointers: {},
  move: (peer, pointer) =>
    set((s) => {
      const pointers = { ...s.pointers };
      if (pointer) pointers[peer] = { ...pointer, at: Date.now() };
      else delete pointers[peer];
      return { pointers };
    }),
  sweep: (now) =>
    set((s) => {
      const stale = Object.keys(s.pointers).filter(
        (peer) => now - s.pointers[peer]!.at >= POINTER_STALE_MS,
      );
      if (!stale.length) return s;
      const pointers = { ...s.pointers };
      for (const peer of stale) delete pointers[peer];
      return { pointers };
    }),
  clear: () => set({ pointers: {} }),
}));

/** The pointers on one canvas, by peer. */
export function pointersOn(
  pointers: State['pointers'],
  docPath: string,
  blockHash: string,
): [string, PointerAt][] {
  return Object.entries(pointers)
    .filter(([, p]) => p.docPath === docPath && p.blockHash === blockHash)
    .map(([peer, { docPath, blockHash, x, y }]) => [peer, { docPath, blockHash, x, y }]);
}
