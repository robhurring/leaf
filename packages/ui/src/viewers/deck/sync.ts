// A deck and its speaker window stay on the same slide: each says where it went, on a
// channel named for the file, and the other follows.
import { emit, listen } from '@tauri-apps/api/event';
import { inTauri } from '../../source/TauriSource.js';

const EVENT = 'leaf-deck';
export function deckChannel(path: string, onIndex: (index: number) => void) {
  const take = (index: unknown) => {
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0) onIndex(index);
  };
  // In the app each window is its own webview, so they talk over the app's event bus,
  // which reaches every window; tagged with who sent it, so a window doesn't hear itself.
  if (inTauri()) {
    const me = Math.random().toString(36).slice(2);
    let stop: (() => void) | null = null;
    let closed = false;
    void listen<{ path: string; index: number; from: string }>(EVENT, (e) => {
      if (e.payload.path === path && e.payload.from !== me) take(e.payload.index);
    }).then((un) => (closed ? un() : (stop = un)));
    return {
      post: (index: number) => void emit(EVENT, { path, index, from: me }),
      close: () => {
        closed = true;
        stop?.();
      },
    };
  }
  if (typeof BroadcastChannel === 'undefined') return { post() {}, close() {} };
  const channel = new BroadcastChannel(`leaf-deck:${path}`);
  channel.onmessage = (e) => take((e.data as { index?: unknown })?.index);
  return {
    post: (index: number) => channel.postMessage({ index }),
    close: () => channel.close(),
  };
}

/** Opens the speaker window for a deck: a second app window, or a popup in a browser. */
export async function openSpeaker(path: string): Promise<void> {
  if (inTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('leaf_open_speaker', { path });
    return;
  }
  window.open(
    `${location.pathname}?speaker`,
    `leaf-speaker:${path}`,
    'popup,width=1200,height=760',
  );
}
