// A deck and its speaker window stay on the same slide: each says where it went, on a
// channel named for the file, and the other follows.
export function deckChannel(path: string, onIndex: (index: number) => void) {
  if (typeof BroadcastChannel === 'undefined') return { post() {}, close() {} };
  const channel = new BroadcastChannel(`leaf-deck:${path}`);
  channel.onmessage = (e) => {
    const index = (e.data as { index?: unknown })?.index;
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0) onIndex(index);
  };
  return {
    post: (index: number) => channel.postMessage({ index }),
    close: () => channel.close(),
  };
}

/** Opens the speaker window for a deck: a second app window, or a popup in a browser. */
export async function openSpeaker(path: string): Promise<void> {
  const { inTauri } = await import('../../source/TauriSource.js');
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
