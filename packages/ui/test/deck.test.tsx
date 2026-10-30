import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FileMessage } from '@leaf/protocol';
import { viewers } from '../src/viewers/index.js';
import { registries } from '../src/render/registries/index.js';
import { isMarp } from '../src/viewers/deck/detect.js';
import { DocumentView } from '../src/components/DocumentView.js';
import { DocToolsContext } from '../src/components/Properties.js';

const DECK = `---
marp: true
---

# One

hello

<!-- Say hello first. -->

---

# Two

- a
- b

---

# Three
`;

const file = (path: string, content: string): FileMessage => ({
  type: 'file',
  path,
  kind: 'text',
  lang: 'markdown',
  mime: 'text/markdown',
  encoding: 'utf8',
  content,
  url: '',
  size: content.length,
  mtime: 1,
});

const counter = () => screen.getByRole('status', { name: 'Slide' }).textContent;
/** The slide on screen, read from inside the deck's own shadow root. */
const shown = () => {
  const root = document.querySelector('.leaf-deck-slides')!.shadowRoot!;
  const slides = [...root.querySelectorAll('svg[data-marpit-svg]')];
  const style = root.querySelector('style#leaf-deck-current')!.textContent!;
  const n = Number(/nth-of-type\((\d+)\)/.exec(style)![1]);
  return slides[n - 1]!.textContent!.trim().split('\n')[0];
};

function openFile(f: FileMessage) {
  const slot = document.createElement('div');
  document.body.append(slot);
  const view = render(
    <DocToolsContext.Provider value={slot}>
      <DocumentView
        file={f}
        path={f.path}
        config={{}}
        numbering={false}
        linkBase=""
        onNavigate={() => {}}
      />
    </DocToolsContext.Provider>,
  );
  return { ...view, slot };
}

describe('Marp decks', () => {
  it('knows a deck by its frontmatter', () => {
    expect(isMarp(DECK)).toBe(true);
    expect(isMarp('# Just a doc\n')).toBe(false);
    expect(isMarp('---\ntitle: x\n---\n# y')).toBe(false);
    expect(viewers.forFile(file('talk.marp', '# a')).id).toBe('deck');
    expect(viewers.forLang('marp')?.id).toBe('deck');
  });

  it('a markdown file with marp: true opens as slides, one at a time', async () => {
    openFile(file('talk.md', DECK));
    await waitFor(() => expect(counter()).toBe('1 / 3'));
    expect(shown()).toBe('One');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('2 / 3');
    expect(shown()).toBe('Two');
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('3 / 3');
    fireEvent.keyDown(window, { key: 'Home' });
    expect(counter()).toBe('1 / 3');
  });

  it('keeps the slide it was on when the file changes', async () => {
    const view = openFile(file('talk.md', DECK));
    await waitFor(() => expect(counter()).toBe('1 / 3'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const slot = view.slot;
    view.rerender(
      <DocToolsContext.Provider value={slot}>
        <DocumentView
          file={file('talk.md', DECK.replace('- b', '- b\n- c'))}
          path="talk.md"
          config={{}}
          numbering={false}
          linkBase=""
          onNavigate={() => {}}
        />
      </DocToolsContext.Provider>,
    );
    await waitFor(() => expect(shown()).toContain('Two'));
    expect(counter()).toBe('2 / 3');
  });

  it('the file toolbar switches a marp document to reading it as a document, and back', async () => {
    const { Reader } = await import('../src/components/Reader.js');
    const { scripted } = await import('./helpers/scripted.js');
    render(<Reader source={scripted({ 'talk.md': DECK }).source} />);
    await waitFor(() => expect(counter()).toBe('1 / 3'));
    const tools = screen.getByRole('toolbar', { name: 'File tools' });
    fireEvent.click(within(tools).getByRole('button', { name: 'Read as a document' }));
    expect(await screen.findByRole('heading', { name: 'One' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Slide' })).toBeNull();
    fireEvent.click(within(tools).getByRole('button', { name: 'Show as slides' }));
    await waitFor(() => expect(counter()).toBe('1 / 3'));
  });

  it('a ```marp fence is a small deck with previous and next', async () => {
    const el = registries.blocks
      .resolve('marp')!
      .render('# A\n\n---\n\n# B\n', '', { docPath: 'doc.md', config: {} }) as ReactElement;
    render(el);
    await waitFor(() => expect(counter()).toBe('1 / 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(counter()).toBe('2 / 2');
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(counter()).toBe('1 / 2');
  });

  it('Present fills the window with the slide; Escape comes back', async () => {
    openFile(file('talk.md', DECK));
    await waitFor(() => expect(counter()).toBe('1 / 3'));
    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(document.querySelector('.leaf-deck[data-presenting]')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(document.querySelector('.leaf-deck[data-presenting]')).toBeNull();
  });

  it('the notes for each slide come from its comments', async () => {
    const { renderDeck } = await import('../src/viewers/deck/marp.js');
    const deck = await renderDeck(DECK);
    expect(deck.count).toBe(3);
    expect(deck.notes[0]).toBe('Say hello first.');
    expect(deck.notes[1]).toBe('');
    expect(deck.html).not.toContain('<script');
  });
});

describe('speaker view', () => {
  it('shows the slide, the next one, and the notes; keys move both windows', async () => {
    const { SpeakerView } = await import('../src/viewers/deck/SpeakerView.js');
    const heard: number[] = [];
    const ear = new BroadcastChannel('leaf-deck:talk.md');
    ear.onmessage = (e) => heard.push((e.data as { index: number }).index);
    render(<SpeakerView content={DECK} docPath="talk.md" />);
    await waitFor(() => expect(counter()).toBe('1 / 3'));
    expect(screen.getByRole('note', { name: 'Notes' }).textContent).toContain('Say hello first.');
    expect(screen.getByRole('region', { name: 'Next slide' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('2 / 3');
    expect(screen.getByRole('note', { name: 'Notes' }).textContent).toMatch(/no notes/i);
    await waitFor(() => expect(heard).toContain(1));
    // The presenting window moved on: the speaker view follows.
    const deckSide = new BroadcastChannel('leaf-deck:talk.md');
    act(() => deckSide.postMessage({ index: 2 }));
    await waitFor(() => expect(counter()).toBe('3 / 3'));
    expect(screen.getByRole('timer', { name: 'Time presenting' })).toBeTruthy();
    ear.close();
    deckSide.close();
  });

  it('the deck follows a speaker window that moves on', async () => {
    openFile(file('talk.md', DECK));
    await waitFor(() => expect(counter()).toBe('1 / 3'));
    const speaker = new BroadcastChannel('leaf-deck:talk.md');
    act(() => speaker.postMessage({ index: 1 }));
    await waitFor(() => expect(counter()).toBe('2 / 3'));
    speaker.close();
  });
});
