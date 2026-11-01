// Which gated blocks the viewer has run in this page load. Kept apart from RunGate so
// the panes can ask without loading it.
const ran = new Set<string>();

export const hasRun = (key: string) => ran.has(key);
export const markRun = (key: string) => void ran.add(key);
