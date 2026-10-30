import { describe, it, expect, vi, afterEach } from 'vitest';

// The app's event bus, shared by every window: what one emits, all hear.
const bus = vi.hoisted(() => {
  const listeners = new Set<(e: { payload: unknown }) => void>();
  return {
    listeners,
    emit: vi.fn(async (_name: string, payload: unknown) => {
      for (const l of [...listeners]) l({ payload });
    }),
    listen: vi.fn(async (_name: string, fn: (e: { payload: unknown }) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }),
  };
});
vi.mock('@tauri-apps/api/event', () => ({ emit: bus.emit, listen: bus.listen }));

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  bus.listeners.clear();
});

describe('deck sync in the app', () => {
  it('two windows on the same deck follow each other over the app bus; other decks do not', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.stubGlobal('BroadcastChannel', undefined);
    const { deckChannel } = await import('../src/viewers/deck/sync.js');
    const deckSide: number[] = [];
    const speakerSide: number[] = [];
    const elsewhere: number[] = [];
    const deck = deckChannel('slides.md', (i) => deckSide.push(i));
    const speaker = deckChannel('slides.md', (i) => speakerSide.push(i));
    const other = deckChannel('other.md', (i) => elsewhere.push(i));
    await new Promise((r) => setTimeout(r, 0));
    speaker.post(3);
    await new Promise((r) => setTimeout(r, 0));
    expect(deckSide).toEqual([3]);
    // A window doesn't hear itself.
    expect(speakerSide).toEqual([]);
    expect(elsewhere).toEqual([]);
    deck.close();
    speaker.post(4);
    await new Promise((r) => setTimeout(r, 0));
    expect(deckSide).toEqual([3]);
    speaker.close();
    other.close();
    vi.unstubAllGlobals();
  });
});
