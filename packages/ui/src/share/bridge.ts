// The app's side of a tab's share: commands to the Rust core and the events it sends
// back. Only the share chunk imports it, so a reader that never shares never loads it.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Peer } from '@leaf/protocol';
import { tauriWindowLabel } from '../source/TauriSource.js';

/** What this tab shares: idle when it isn't; `resumable` is a share its closed tab left. */
export type TabShare = {
  id: string;
  webUrl: string;
  appUrl: string;
  status: 'idle' | 'live' | 'reconnecting' | 'ended';
  viewers: Peer[];
  resumable?: string;
};

export function shareState(): Promise<TabShare> {
  return invoke<TabShare>('leaf_share_state');
}
export function shareStart(): Promise<TabShare> {
  return invoke<TabShare>('leaf_share_start');
}
export function shareResume(): Promise<TabShare> {
  return invoke<TabShare>('leaf_share_resume');
}
export function shareEnd(): Promise<void> {
  return invoke<void>('leaf_share_end');
}

/** Hears every change to this tab's share (viewers, status); returns a function that stops it. */
export function onShare(fn: (s: TabShare) => void): () => void {
  let off: UnlistenFn | null = null;
  let stopped = false;
  void listen<TabShare>(`leaf://share/${tauriWindowLabel()}`, (e) => fn(e.payload)).then((u) => {
    if (stopped) u();
    else off = u;
  });
  return () => {
    stopped = true;
    off?.();
  };
}
