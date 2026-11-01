import { create } from 'zustand';
import {
  shareEnd,
  shareResume,
  shareStart,
  shareState,
  type TabShare,
} from '../source/TauriSource.js';

export type Copied = { which: 'app' | 'web'; ok: boolean } | null;

type ShareStore = {
  state: TabShare | null;
  busy: boolean;
  /** The last start/resume failure, shown for a few seconds. */
  error: string | null;
  /** True for a few seconds after a share ends. */
  ended: boolean;
  /** Which link was just copied, for the check flash. */
  copied: Copied;
  /** Takes a state the app pushed; an `ended` one raises the notice. */
  apply(s: TabShare): void;
  load(): Promise<void>;
  start(): Promise<void>;
  resume(): Promise<void>;
  end(): Promise<void>;
  copy(which: 'app' | 'web'): Promise<void>;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
/** Sets `key` for `ms`, then resets it to `off`; a newer set replaces the older timer. */
function flash<K extends 'error' | 'ended' | 'copied'>(
  set: (p: Partial<ShareStore>) => void,
  key: K,
  value: ShareStore[K],
  off: ShareStore[K],
  ms: number,
) {
  clearTimeout(timers[key]);
  set({ [key]: value } as Partial<ShareStore>);
  timers[key] = setTimeout(() => set({ [key]: off } as Partial<ShareStore>), ms);
}

export const useShare = create<ShareStore>((set, get) => {
  /** Counts the states pushed since the page began; a slower `load` must not undo a newer one. */
  let seq = 0;
  const run = async (go: () => Promise<TabShare>) => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      seq++;
      set({ state: await go(), busy: false });
    } catch (e) {
      set({ busy: false });
      flash(set, 'error', message(e), null, 4000);
    }
  };
  return {
    state: null,
    busy: false,
    error: null,
    ended: false,
    copied: null,
    apply: (s) => {
      seq++;
      set({ state: s });
      if (s.status === 'ended') flash(set, 'ended', true, false, 4000);
    },
    load: async () => {
      const started = seq;
      try {
        const s = await shareState();
        if (seq === started) set({ state: s });
      } catch {
        /* not in the app: no share */
      }
    },
    start: () => run(shareStart),
    resume: () => run(shareResume),
    end: async () => {
      if (get().busy) return;
      set({ busy: true });
      try {
        await shareEnd();
        seq++;
        set({ state: await shareState() });
        flash(set, 'ended', true, false, 4000);
      } catch {
        /* the app keeps the share; its next state says so */
      }
      set({ busy: false });
    },
    copy: async (which) => {
      const s = get().state;
      const url = which === 'app' ? s?.appUrl : s?.webUrl;
      const ok = await navigator.clipboard.writeText(url ?? '').then(
        () => true,
        () => false,
      );
      flash(set, 'copied', { which, ok }, null, 1500);
    },
  };
});
