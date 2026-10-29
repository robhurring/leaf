// A short message at the foot of the window, with at most one action: the one place
// the app says something happened that the person didn't see.
import { create } from 'zustand';

export type Notice = { text: string; action?: { label: string; command: string } };

export const useNotice = create<{
  notice: Notice | null;
  show(n: Notice): void;
  clear(): void;
  /** The app window refused a link of this kind (not allowed in Settings). */
  linkRefused(scheme: string): void;
}>((set, get) => ({
  notice: null,
  show: (notice) => set({ notice }),
  clear: () => set({ notice: null }),
  linkRefused: (scheme) =>
    get().show({
      text: `leaf doesn't open ${scheme}: links. Allow them in Settings.`,
      action: { label: 'Settings', command: 'openSettings' },
    }),
}));
