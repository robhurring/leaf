// Which gated blocks the viewer has run in this page load, and which shares they have
// allowed outright. Kept apart from RunGate so the panes can ask without loading it.
const ran = new Set<string>();
const allowed = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

export const hasRun = (key: string) => ran.has(key);
export function markRun(key: string) {
  ran.add(key);
  changed();
}

/** Every block of share `id` may run for the rest of this page load (not saved, yet). */
export function allowShare(id: string) {
  allowed.add(id);
  changed();
}
export const shareAllowed = (id: string) => allowed.has(id);
/** Hears each block run and each share allowed; for useSyncExternalStore. */
export function onAllowed(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
