import { describe, it, expect, vi } from 'vitest';
import { installShortcuts, type ShortcutActions } from '../src/shortcuts.js';

function actions() {
  return {
    toggleTree: vi.fn(),
    toggleOutline: vi.fn(),
    toggleNumbering: vi.fn(),
    toggleAppearance: vi.fn(),
    openPalette: vi.fn(),
    openFiles: vi.fn(),
    openFind: vi.fn(),
    closeOverlays: vi.fn(),
    scrollBy: vi.fn(),
    jumpHeading: vi.fn(),
  } satisfies ShortcutActions;
}
const key = (init: KeyboardEventInit) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

describe('shortcuts', () => {
  it('is quiet while an overlay reports itself open, except Escape', () => {
    const a = actions();
    const off = installShortcuts(a, window, () => true);
    key({ key: 'j' });
    key({ key: 'k', metaKey: true });
    key({ key: 'o', ctrlKey: true });
    key({ key: 'd', ctrlKey: true });
    expect(a.scrollBy).not.toHaveBeenCalled();
    expect(a.openPalette).not.toHaveBeenCalled();
    expect(a.openFiles).not.toHaveBeenCalled();
    key({ key: 'Escape' });
    expect(a.closeOverlays).toHaveBeenCalledTimes(1);
    off();
  });

  it('vim-style scrolling: j/k lines, ctrl-d/ctrl-u half pages', () => {
    const a = actions();
    const off = installShortcuts(a);
    key({ key: 'j' });
    key({ key: 'k' });
    key({ key: 'd', ctrlKey: true });
    key({ key: 'u', ctrlKey: true });
    expect(a.scrollBy.mock.calls).toEqual([
      ['line', 1],
      ['line', -1],
      ['half', 1],
      ['half', -1],
    ]);
    off();
  });
  it('cmd-k opens headings, cmd-o opens files', () => {
    const a = actions();
    const off = installShortcuts(a);
    key({ key: 'k', metaKey: true });
    key({ key: 'o', ctrlKey: true });
    expect(a.openPalette).toHaveBeenCalledTimes(1);
    expect(a.openFiles).toHaveBeenCalledTimes(1);
    off();
  });
  it('ignores keys while typing', () => {
    const a = actions();
    const off = installShortcuts(a);
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(a.scrollBy).not.toHaveBeenCalled();
    input.remove();
    off();
  });

  it('vim-style pages and headings: ctrl-f/ctrl-b full pages, ctrl-n/ctrl-p next and previous heading', () => {
    const a = actions();
    const off = installShortcuts(a);
    key({ key: 'f', ctrlKey: true });
    key({ key: 'b', ctrlKey: true });
    key({ key: 'n', ctrlKey: true });
    key({ key: 'p', ctrlKey: true });
    expect(a.scrollBy.mock.calls).toEqual([
      ['page', 1],
      ['page', -1],
    ]);
    expect(a.jumpHeading.mock.calls).toEqual([[1], [-1]]);
    off();
  });
});

describe('history shortcuts', () => {
  it('⌘[ goes back and ⌘] forward; bare [ and ] still toggle the sidebars', () => {
    const a = { ...actions(), goBack: vi.fn(), goForward: vi.fn() };
    const off = installShortcuts(a, window);
    key({ key: '[', metaKey: true });
    key({ key: ']', metaKey: true });
    expect(a.goBack).toHaveBeenCalledTimes(1);
    expect(a.goForward).toHaveBeenCalledTimes(1);
    expect(a.toggleTree).not.toHaveBeenCalled();
    key({ key: '[' });
    expect(a.toggleTree).toHaveBeenCalledTimes(1);
    off();
  });

  it('the mouse back and forward buttons navigate', () => {
    const a = { ...actions(), goBack: vi.fn(), goForward: vi.fn() };
    const off = installShortcuts(a, window);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 3 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 4 }));
    expect(a.goBack).toHaveBeenCalledTimes(1);
    expect(a.goForward).toHaveBeenCalledTimes(1);
    off();
  });
});
