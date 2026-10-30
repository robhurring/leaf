// Preferences the server keeps across launches. The ui store stays the single
// source of truth for the page; this module mirrors a subset of it to the
// server (and back) when the server says it stores preferences.
import type { ClientMessage, Preferences } from '@leaf/protocol';
import { useUi, type UiState } from './ui.js';

export const PREFERENCE_KEYS = [
  'theme',
  'appearance',
  'treeOpen',
  'outlineOpen',
  'numbering',
  'textPct',
  'treeWidth',
  'outlineWidth',
  'linkSchemes',
  'openIn',
  'reopenTabs',
] as const satisfies readonly (keyof Preferences)[];

let applying = false;

/** Applies the server's stored values without echoing them back. */
export function applyRemotePreferences(prefs: Preferences): void {
  const patch: Partial<UiState> = {};
  for (const key of PREFERENCE_KEYS)
    if (prefs[key] !== undefined) (patch as Record<string, unknown>)[key] = prefs[key];
  applying = true;
  try {
    useUi.setState(patch);
  } finally {
    applying = false;
  }
}

/** Sends each local preference change to the server as a patch. Returns the unsubscribe. */
export function syncPreferences(send: (msg: ClientMessage) => void): () => void {
  return useUi.subscribe((state, prev) => {
    if (applying) return;
    const patch: Preferences = {};
    for (const key of PREFERENCE_KEYS)
      if (state[key] !== prev[key]) (patch as Record<string, unknown>)[key] = state[key];
    if (Object.keys(patch).length) send({ type: 'preferences', preferences: patch });
  });
}
