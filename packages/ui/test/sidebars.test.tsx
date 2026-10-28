import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { useUi, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT } from '../src/store/ui.js';
import { PREFERENCE_KEYS } from '../src/store/preferences.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
  useUi.setState({
    treeOpen: true,
    outlineOpen: true,
    treeWidth: SIDEBAR_DEFAULT,
    outlineWidth: SIDEBAR_DEFAULT,
  });
});

const dir = () => scripted({ 'README.md': README, 'docs/guide.md': GUIDE });

describe('sidebar widths', () => {
  it('clamps to the allowed range and is stored with the other preferences', () => {
    useUi.getState().setSidebarWidth('tree', 9999);
    expect(useUi.getState().treeWidth).toBe(SIDEBAR_MAX);
    useUi.getState().setSidebarWidth('outline', 10);
    expect(useUi.getState().outlineWidth).toBe(SIDEBAR_MIN);
    expect(PREFERENCE_KEYS).toContain('treeWidth');
    expect(PREFERENCE_KEYS).toContain('outlineWidth');
  });

  it('sets the grid columns from the stored widths', async () => {
    useUi.setState({ treeWidth: 300, outlineWidth: 220 });
    const { container } = render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    const app = container.querySelector<HTMLElement>('.leaf-app')!;
    expect(app.style.getPropertyValue('--leaf-tree-w')).toBe('300px');
    expect(app.style.getPropertyValue('--leaf-outline-w')).toBe('220px');
  });

  it('resizes from a handle by keyboard, and double-click resets', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    const handle = screen.getByRole('separator', { name: 'Resize files' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(useUi.getState().treeWidth).toBe(SIDEBAR_DEFAULT + 16);
    fireEvent.doubleClick(handle);
    expect(useUi.getState().treeWidth).toBe(SIDEBAR_DEFAULT);
    const outline = screen.getByRole('separator', { name: 'Resize outline' });
    // The outline sits on the right, so dragging or pressing left widens it.
    fireEvent.keyDown(outline, { key: 'ArrowLeft' });
    expect(useUi.getState().outlineWidth).toBe(SIDEBAR_DEFAULT + 16);
  });

  it('resizes by dragging the handle', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    const handle = screen.getByRole('separator', { name: 'Resize files' });
    fireEvent.pointerDown(handle, { clientX: 260, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 320, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 320, pointerId: 1 });
    expect(useUi.getState().treeWidth).toBe(SIDEBAR_DEFAULT + 60);
  });
});
