import { useDocuments } from './documents.js';
import { useUi } from './ui.js';

export { useDocuments } from './documents.js';
export { useUi, applyTheme, THEMES, TEXT_MIN, TEXT_MAX } from './ui.js';
export type { DocumentsState } from './documents.js';
export type { UiState, Theme, Appearance } from './ui.js';

/** Both stores, for host apps that render their own chrome. */
export function useLeaf() {
  return { documents: useDocuments(), ui: useUi() };
}
