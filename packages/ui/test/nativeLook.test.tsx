import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  return {
    handlers,
    listen: vi.fn(async (name: string, fn: (e: { payload: unknown }) => void, _opts?: unknown) => {
      handlers.set(name, fn);
      return () => handlers.delete(name);
    }),
  };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

const { Reader } = await import('../src/components/Reader.js');
const { useDocuments } = await import('../src/store/documents.js');
const { useUi } = await import('../src/store/ui.js');
const { scripted, README } = await import('./helpers/scripted.js');

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  (window as unknown as Record<string, unknown>).__LEAF_WINDOW__ = 'w7';
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
  useUi.getState().setOutlineOpen(true);
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('in the app window', () => {
  it('uses the one native look: no theme picker, light/dark/system, inset bar', async () => {
    render(<Reader source={scripted({ 'README.md': README }).source} />);
    await screen.findByRole('heading', { level: 1 });
    expect(document.documentElement.dataset.theme).toBe('native');
    const bar = document.querySelector('header.leaf-bar')!;
    expect(bar.classList.contains('leaf-bar-native')).toBe(true);
    expect(bar.hasAttribute('data-tauri-drag-region')).toBe(true);
    // Tauri drags only from the element pressed, so every empty area of the bar carries the
    // attribute and every control does not.
    for (const part of ['.leaf-bar-left', '.leaf-bar-center', '.leaf-bar-right'])
      expect(bar.querySelector(part)!.hasAttribute('data-tauri-drag-region'), part).toBe(true);
    for (const b of bar.querySelectorAll('button'))
      expect(b.hasAttribute('data-tauri-drag-region')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    // Local and always connected: no connection dot in the app.
    expect(document.querySelector('.leaf-dot')).toBeNull();
    expect(document.documentElement.dataset.shell).toBe('app');
    const items = screen.getAllByRole('menuitemradio').map((b) => b.textContent);
    expect(items).toEqual(['Light', 'Dark', 'System']);
  });

  it('native menu commands arrive as leaf://command events and run', async () => {
    render(<Reader source={scripted({ 'README.md': README }).source} />);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(mocks.handlers.has('leaf://command')).toBe(true));
    // Only this window's commands: the listener is targeted at its own webview.
    expect(mocks.listen).toHaveBeenCalledWith('leaf://command', expect.any(Function), {
      target: { kind: 'WebviewWindow', label: 'w7' },
    });
    mocks.handlers.get('leaf://command')!({ payload: { name: 'toggleOutline' } });
    await waitFor(() => expect(useUi.getState().outlineOpen).toBe(false));
    mocks.handlers.get('leaf://command')!({ payload: { name: 'setAppearance', arg: 'dark' } });
    await waitFor(() => expect(useUi.getState().appearance).toBe('dark'));
  });
});
