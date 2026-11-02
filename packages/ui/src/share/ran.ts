// Which gated blocks the viewer has run in this page load, and which shares they have
// allowed outright. Kept apart from RunGate so the panes can ask without loading it.
const ran = new Set<string>();
const allowed = new Set<string>();
const listeners = new Set<() => void>();

export const hasRun = (key: string) => ran.has(key);
export const markRun = (key: string) => void ran.add(key);

/** Every block of share `id` may run for the rest of this page load (not saved, yet). */
export function allowShare(id: string) {
  allowed.add(id);
  listeners.forEach((fn) => fn());
}
export const shareAllowed = (id: string) => allowed.has(id);
/** Hears each share allowed; for useSyncExternalStore. */
export function onAllowed(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
