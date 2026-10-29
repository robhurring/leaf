import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_LINK_SCHEMES } from '@leaf/protocol';
import { Settings } from '../src/components/Settings.js';
import { useUi } from '../src/store/ui.js';

beforeEach(() => useUi.setState({ linkSchemes: [...DEFAULT_LINK_SCHEMES] }));

const kinds = () =>
  within(screen.getByRole('list', { name: 'Allowed link kinds' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent!.replace(/×$/, '').trim());

describe('Settings', () => {
  it('lists the kinds of link that open in other apps, starting from the defaults', () => {
    render(<Settings onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(kinds()).toEqual([...DEFAULT_LINK_SCHEMES]);
  });

  it('removes a kind, and adds one written any way people write it', () => {
    render(<Settings onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove zed' }));
    expect(kinds()).not.toContain('zed');
    const input = screen.getByRole('textbox', { name: 'Add a link kind' });
    fireEvent.change(input, { target: { value: ' Obsidian:// ' } });
    fireEvent.submit(input.closest('form')!);
    expect(kinds()).toContain('obsidian');
    expect((input as HTMLInputElement).value).toBe('');
    expect(useUi.getState().linkSchemes).toContain('obsidian');
    expect(JSON.parse(localStorage.getItem('leaf.ui')!).state.linkSchemes).toContain('obsidian');
  });

  it('refuses kinds that run code, and anything that isn’t a scheme, saying why', () => {
    render(<Settings onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Add a link kind' });
    fireEvent.change(input, { target: { value: 'javascript' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/javascript: links never open/);
    fireEvent.change(input, { target: { value: 'not a scheme' } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/letters/);
    expect(kinds()).toEqual([...DEFAULT_LINK_SCHEMES]);
  });

  it('restores the defaults, and closes with Escape or its button', () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove vscode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(kinds()).toEqual([...DEFAULT_LINK_SCHEMES]);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
