import { create } from 'zustand';
import {
  shareEnd,
  shareResume,
  shareStart,
  shareState,
  type TabShare,
} from '../source/TauriSource.js';

type ShareStore = {
  state: TabShare | null;
  busy: boolean;
  error: string | null;
  load(): Promise<void>;
  start(): Promise<void>;
  resume(): Promise<void>;
  end(): Promise<void>;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useShare = create<ShareStore>((set, get) => {
  const run = async (go: () => Promise<TabShare | void>, ends = false) => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      const next = await go();
      set({ state: next ?? get().state, busy: false });
    } catch (e) {
      set({ busy: false, error: ends ? null : message(e) });
    }
  };
  return {
    state: null,
    busy: false,
    error: null,
    load: async () => {
      try {
        set({ state: await shareState() });
      } catch {
        /* not in the app: no share */
      }
    },
    start: () => run(shareStart),
    resume: () => run(shareResume),
    end: () =>
      run(async () => {
        await shareEnd();
        return shareState();
      }, true),
  };
});
