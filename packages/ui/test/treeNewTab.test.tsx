import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { Tree } from '../src/components/Tree.js';
import { useDocuments } from '../src/store/documents.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

const w = window as unknown as Record<string, unknown>;
beforeEach(() => {
  useDocuments.setState({
    tree: {
      '': [
        { name: 'docs', path: 'docs', kind: 'dir' },
        { name: 'README.md', path: 'README.md', kind: 'file' },
      ],
    },
  } as never);
  vi.mocked(invoke).mockClear();
});
afterEach(() => {
  delete w.__TAURI_INTERNALS__;
  delete w.__LEAF_TAB__;
});
const inTab = () => {
  w.__TAURI_INTERNALS__ = {};
  w.__LEAF_TAB__ = true;
};
const row = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Files' })).getByRole('button', { name });

describe('opening a file in a new tab from the tree', () => {
  it('⌘-click opens it in a new tab when in a tab of the app', () => {
    inTab();
    const onOpen = vi.fn();
    render(<Tree onOpen={onOpen} />);
    fireEvent.click(row('README.md'), { metaKey: true });
    expect(invoke).toHaveBeenCalledWith('leaf_open_in_new_tab', { path: 'README.md' });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a plain click still opens it here', () => {
    inTab();
    const onOpen = vi.fn();
    render(<Tree onOpen={onOpen} />);
    fireEvent.click(row('README.md'));
    expect(onOpen).toHaveBeenCalledWith('README.md');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('outside the app, ⌘-click opens it here', () => {
    const onOpen = vi.fn();
    render(<Tree onOpen={onOpen} />);
    fireEvent.click(row('README.md'), { metaKey: true });
    expect(onOpen).toHaveBeenCalledWith('README.md');
  });

  it('right-click on a file asks for the app’s menu; on a folder it doesn’t', () => {
    inTab();
    render(<Tree onOpen={() => {}} />);
    fireEvent.contextMenu(row('README.md'));
    expect(invoke).toHaveBeenCalledWith('leaf_tree_menu', { path: 'README.md' });
    vi.mocked(invoke).mockClear();
    fireEvent.contextMenu(row('docs'));
    expect(invoke).not.toHaveBeenCalled();
  });
});
