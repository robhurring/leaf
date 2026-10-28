import { describe, it, expect, vi } from 'vitest';

describe('copyImage on Safari', () => {
  it('hands ClipboardItem a promise so the write keeps the user gesture', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(items: Record<string, unknown>) {
          seen.push(items['image/png']);
        }
      },
    );
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    const mod = await import('../src/stage/image.js');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    await mod.copyImage(svg).catch(() => {});
    expect(write).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBeInstanceOf(Promise);
    vi.unstubAllGlobals();
  });
});
