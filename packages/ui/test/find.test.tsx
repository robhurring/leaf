import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { findMatches, paintMatches } from '../src/find.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';
import { installShortcuts } from '../src/shortcuts.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
});

describe('findMatches', () => {
  it('finds every case-insensitive occurrence in the text, skipping hidden chrome', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p>Setup one, <b>setup</b> two</p><button class="leaf-block-tools">Setup</button><p>SETUP</p>';
    const ranges = findMatches(root, 'setup');
    expect(ranges.map((r) => r.toString())).toEqual(['Setup', 'setup', 'SETUP']);
    expect(findMatches(root, '')).toEqual([]);
    expect(findMatches(root, 'nope')).toEqual([]);
  });
});

describe('highlight styles', () => {
  it('are added to the page at runtime, once, since the CSS minifier rejects ::highlight', () => {
    paintMatches([], 0);
    paintMatches([], 0);
    const styles = document.querySelectorAll('style#leaf-find-styles');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain('::highlight(leaf-find-current)');
  });
});

describe('find bar', () => {
  it('⌘F opens it; typing counts matches; Enter moves; Escape closes', async () => {
    render(<Reader source={scripted({ 'README.md': README, 'docs/guide.md': GUIDE }).source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    const box = await screen.findByRole('searchbox', { name: 'Find in document' });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'setup' } });
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy());
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('2 of 2')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('1 of 2')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('2 of 2')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByText('No results')).toBeTruthy());
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('searchbox', { name: 'Find in document' })).toBeNull();
  });
});

describe('shortcut', () => {
  it('⌘F finds, but ctrl-f still pages down like vim', () => {
    const calls: string[] = [];
    const off = installShortcuts({
      toggleTree() {},
      toggleOutline() {},
      toggleNumbering() {},
      toggleAppearance() {},
      openPalette() {},
      openFiles() {},
      closeOverlays() {},
      openFind: () => calls.push('find'),
      scrollBy: (u) => calls.push(u),
      jumpHeading() {},
    });
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    off();
    expect(calls).toEqual(['find', 'page']);
  });
});
