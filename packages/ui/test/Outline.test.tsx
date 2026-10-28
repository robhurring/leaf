import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README } from './helpers/scripted.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
});

/** Lays the document out: each heading `top` px below the scroller's top edge. */
function layout(tops: Record<string, number>, scroller: HTMLElement, height = 600) {
  const rect = (top: number, h = 20) =>
    ({
      top,
      bottom: top + h,
      left: 0,
      right: 0,
      width: 0,
      height: h,
      x: 0,
      y: top,
      toJSON() {},
    }) as DOMRect;
  scroller.getBoundingClientRect = () => rect(0, height);
  for (const [id, top] of Object.entries(tops))
    document.getElementById(id)!.getBoundingClientRect = () => rect(top);
}

const current = (outline: HTMLElement) =>
  within(outline).queryByRole('link', { current: 'location' })?.getAttribute('href');

describe('Outline', () => {
  it('follows the scroll: the current heading is the last one above the top edge', async () => {
    render(<Reader source={scripted({ 'README.md': README }).source} />);
    await screen.findByRole('heading', { level: 1 });
    const outline = screen.getByRole('navigation', { name: 'Outline' });
    const main = document.querySelector<HTMLElement>('.leaf-main')!;
    await waitFor(() => expect(document.getElementById('deeper')).toBeTruthy());
    layout({ setup: -300, 'setup-1': 40, deeper: 500 }, main);
    await act(async () => {
      main.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(current(outline)).toBe('#setup-1');
    layout({ setup: -900, 'setup-1': -500, deeper: -10 }, main);
    await act(async () => {
      main.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(current(outline)).toBe('#deeper');
  });

  it('a click marks the heading current even when the page cannot scroll it to the top', async () => {
    render(<Reader source={scripted({ 'README.md': README }).source} />);
    await screen.findByRole('heading', { level: 1 });
    const outline = screen.getByRole('navigation', { name: 'Outline' });
    const main = document.querySelector<HTMLElement>('.leaf-main')!;
    await waitFor(() => expect(document.getElementById('deeper')).toBeTruthy());
    // Near the end of the page: Deeper is on screen but far below the top edge.
    layout({ setup: -100, 'setup-1': 30, deeper: 400 }, main);
    fireEvent.click(within(outline).getByRole('link', { name: 'Deeper' }));
    expect(location.hash).toBe('#deeper');
    expect(current(outline)).toBe('#deeper');
    await act(async () => {
      main.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(current(outline)).toBe('#deeper');
    // Scrolled away so it leaves the screen: tracking resumes.
    layout({ setup: -100, 'setup-1': 30, deeper: 900 }, main);
    await act(async () => {
      main.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(current(outline)).toBe('#setup-1');
  });

  it('the title is the root of the outline and is current at the top of the page', async () => {
    render(<Reader source={scripted({ 'README.md': README }).source} />);
    await screen.findByRole('heading', { level: 1 });
    const outline = screen.getByRole('navigation', { name: 'Outline' });
    const main = document.querySelector<HTMLElement>('.leaf-main')!;
    await waitFor(() => expect(document.getElementById('deeper')).toBeTruthy());
    const title = within(outline).getByRole('link', { name: 'Title' });
    // Sections hang under the title.
    expect(
      title.closest('li')!.contains(within(outline).getByRole('link', { name: 'Deeper' })),
    ).toBe(true);
    layout({ title: 20, setup: 300, 'setup-1': 500, deeper: 700 }, main);
    await act(async () => {
      main.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(current(outline)).toBe('#title');
    // Collapse all keeps the title's sections in view: it folds the sections themselves.
    fireEvent.click(within(outline).getByRole('button', { name: 'Collapse all' }));
    expect(within(outline).getAllByRole('link', { name: 'Setup' })).toHaveLength(2);
    expect(within(outline).queryByRole('link', { name: 'Deeper' })).toBeNull();
  });
});
