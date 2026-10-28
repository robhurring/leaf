import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
});

const files = () => scripted({ 'README.md': README, 'docs/guide.md': GUIDE }).source;
const open = async (key = 'k') => {
  render(<Reader source={files()} />);
  await screen.findByRole('heading', { level: 1 });
  fireEvent.keyDown(window, { key, metaKey: true });
  return screen.findByRole('combobox', { name: 'Go to' });
};
const group = (name: string) => screen.queryByRole('group', { name });

describe('Go to', () => {
  it('is the search field in the title bar, with its results dropping down beneath it', async () => {
    const box = await open();
    expect(screen.getByRole('banner').contains(box)).toBe(true);
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Results' })).toBeTruthy();
  });

  it('finds headings, files, and text in the document from one query', async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: 'guide' } });
    await waitFor(() => expect(group('Files')).toBeTruthy());
    expect(within(group('Files')!).getByRole('option', { name: /docs\/guide\.md/ })).toBeTruthy();
    const text = within(group('In this document')!).getAllByRole('option');
    expect(text[0]!.textContent).toContain('Intro with a guide link');
    fireEvent.change(box, { target: { value: 'set' } });
    const headings = within(group('Headings')!).getAllByRole('option');
    expect(headings.filter((o) => o.textContent?.includes('Setup'))).toHaveLength(2);
  });

  it('Enter jumps to a heading; ctrl-n / ctrl-p move', async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: 'set' } });
    fireEvent.keyDown(box, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'p', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(location.hash).toBe('#setup-1');
    expect(screen.queryByRole('combobox', { name: 'Go to' })).toBeNull();
  });

  it('choosing a text match opens find at that match', async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: 'setup' } });
    const text = within(group('In this document')!).getAllByRole('option');
    fireEvent.click(text[1]!);
    const find = await screen.findByRole('searchbox', { name: 'Find in document' });
    expect((find as HTMLInputElement).value).toBe('setup');
    await waitFor(() => expect(screen.getByText('2 of 2')).toBeTruthy());
  });

  it('⌘O lists files only and opens them', async () => {
    const box = await open('o');
    expect(group('Headings')).toBeNull();
    fireEvent.change(box, { target: { value: 'guide' } });
    const file = await screen.findByRole('option', { name: /docs\/guide\.md/ });
    expect(group('In this document')).toBeNull();
    fireEvent.click(file);
    expect(await screen.findByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
  });

  it('Escape or a click outside closes', async () => {
    await open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Go to' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to' }));
    await screen.findByRole('combobox', { name: 'Go to' });
    fireEvent.mouseDown(document.querySelector('.leaf-goto-scrim')!);
    expect(screen.queryByRole('combobox', { name: 'Go to' })).toBeNull();
  });
  it('finds text in other files and opens the file with find on the query', async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: 'body' } });
    const other = await screen.findByRole('group', { name: 'In other files' });
    const hit = within(other).getByRole('option', { name: /docs\/guide\.md.*Guide body/ });
    expect(within(other).queryByRole('option', { name: /README\.md/ })).toBeNull();
    fireEvent.click(hit);
    expect(await screen.findByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
    const find = await screen.findByRole('searchbox', { name: 'Find in document' });
    expect((find as HTMLInputElement).value).toBe('body');
  });
});
