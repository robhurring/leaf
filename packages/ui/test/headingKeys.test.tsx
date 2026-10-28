import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README } from './helpers/scripted.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
});

const rect = (top: number) =>
  ({
    top,
    bottom: top + 20,
    left: 0,
    right: 0,
    width: 0,
    height: 20,
    x: 0,
    y: top,
    toJSON() {},
  }) as DOMRect;

describe('ctrl-n / ctrl-p', () => {
  it('step past the heading just jumped to, though it rests a scroll margin below the top', async () => {
    render(<Reader source={scripted({ 'README.md': README }).source} />);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(document.getElementById('deeper')).toBeTruthy());
    const main = document.querySelector<HTMLElement>('.leaf-main')!;
    main.getBoundingClientRect = () => rect(0);
    // "setup" was just jumped to: it sits 16px down, its scroll margin.
    const tops: Record<string, number> = { title: -400, setup: 16, 'setup-1': 300, deeper: 600 };
    for (const [id, top] of Object.entries(tops)) {
      const el = document.getElementById(id)!;
      el.style.scrollMarginTop = '16px';
      el.getBoundingClientRect = () => rect(top);
    }
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(location.hash).toBe('#setup-1');
    history.replaceState(null, '', '/');
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(location.hash).toBe('#title');
  });
});
