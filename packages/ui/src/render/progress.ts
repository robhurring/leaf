// Counts on-demand loads in flight (diagram engines, math, the editor, grammars) so
// the chrome can show a thin progress bar while any of them is loading.
import { create } from 'zustand';

export const useProgress = create<{ pending: number }>(() => ({ pending: 0 }));

/** Marks `p` as loading until it settles; returns it unchanged. */
export function track<T>(p: Promise<T>): Promise<T> {
  useProgress.setState((s) => ({ pending: s.pending + 1 }));
  const done = () => useProgress.setState((s) => ({ pending: Math.max(0, s.pending - 1) }));
  p.then(done, done);
  return p;
}
