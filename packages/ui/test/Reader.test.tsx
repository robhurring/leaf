import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useNotice } from '../src/store/notice.js';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README, GUIDE } from './helpers/scripted.js';
import { useUi } from '../src/store/ui.js';
import { runCommand } from '../src/commands.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
});

const dir = () =>
  scripted({ 'README.md': README, 'docs/guide.md': GUIDE, 'notes.txt': 'plain text' });

describe('Reader', () => {
  it('renders README by default with title and outline', async () => {
    render(<Reader source={dir().source} />);
    expect(await screen.findByRole('heading', { name: 'Title', level: 1 })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Outline' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Files' })).toBeTruthy();
    // The file's name lives in the file header, not the title bar.
    expect(screen.getByRole('banner').textContent).not.toContain('README.md');
    expect(screen.getByRole('banner').textContent).not.toContain('Title');
  });

  it('hides the tree for a single file', async () => {
    const single = scripted({ 'README.md': README }, { kind: 'file', name: 'README.md' });
    render(<Reader source={single.source} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull();
  });

  it('toggles the tree and outline, and remembers it', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle files' }));
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle outline' }));
    expect(screen.queryByRole('navigation', { name: 'Outline' })).toBeNull();
    const saved = JSON.parse(localStorage.getItem('leaf.ui')!).state;
    expect(saved.treeOpen).toBe(false);
    expect(saved.outlineOpen).toBe(false);
  });

  it('numbering toggle numbers the document and the outline', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Number headings' }));
    const doc = screen.getByRole('article');
    await waitFor(() => expect(within(doc).getAllByText(/^1\.?\s*$/).length).toBeGreaterThan(0));
    const outline = screen.getByRole('navigation', { name: 'Outline' });
    expect(outline.textContent).toContain('1. Setup');
    expect(outline.textContent).toContain('2. Setup');
    expect(outline.textContent).toContain('2.1 Deeper');
  });

  it('text size control', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    expect(screen.getByRole('button', { name: /reset text size/i }).textContent).toBe('110%');
    expect(document.documentElement.style.getPropertyValue('--leaf-text-scale')).toBe('1.1');
    fireEvent.click(screen.getByRole('button', { name: /reset text size/i }));
    expect(screen.getByRole('button', { name: /reset text size/i }).textContent).toBe('100%');
  });

  it('clicking a tree file opens it and updates the url', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    const files = screen.getByRole('navigation', { name: 'Files' });
    fireEvent.click(within(files).getByText('docs'));
    fireEvent.click(await within(files).findByText('guide.md'));
    expect(await screen.findByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
    expect(location.pathname).toBe('/docs/guide.md');
  });

  it('an in-document relative link navigates', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(await screen.findByRole('link', { name: 'guide' }));
    expect(await screen.findByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
    expect(location.pathname).toBe('/docs/guide.md');
  });

  it('opens the document named in the url', async () => {
    history.replaceState(null, '', '/docs/guide.md');
    render(<Reader source={dir().source} />);
    expect(await screen.findByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
  });

  it('non-markdown files use their viewer', async () => {
    history.replaceState(null, '', '/notes.txt');
    render(<Reader source={dir().source} />);
    await waitFor(() => expect(document.querySelector('.cm-editor')).toBeTruthy());
  });

  it('theme menu switches theme and appearance', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Appearance and settings' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Card' }));
    expect(document.documentElement.dataset.theme).toBe('card');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.appearance).toBe('dark');
  });

  it('connection dot reflects status', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('status', { name: /connected/i })).toBeTruthy();
  });

  it('a folder with no document at its top shows the tree and says so, instead of spinning', async () => {
    const { source } = scripted({ 'screenshots/a.png': 'x', 'screenshots/b.png': 'y' });
    render(<Reader source={source} />);
    expect(await screen.findByText(/No document at the top of this folder/)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Files' })).toBeTruthy();
    expect(screen.queryByText(/Opening/)).toBeNull();
  });

  it('a file header above the document shows the path and facts, and Properties opens beneath it', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Files' })).getByText('docs'));
    fireEvent.click(await screen.findByText('guide.md'));
    await screen.findByRole('heading', { name: 'Guide', level: 1 });
    const head = screen.getByRole('region', { name: 'File' });
    const main = document.querySelector('main.leaf-main')!;
    // Fixed above the scrolling document, not inside it.
    expect(main.contains(head)).toBe(false);
    expect(head.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(head).getByLabelText('Path').textContent).toBe('docs/guide.md');
    expect(within(head).getByLabelText(/^Modified/)).toBeTruthy();
    fireEvent.click(within(head).getByRole('button', { name: /Properties/ }));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('code files fill the document area, with their controls in the file header', async () => {
    render(
      <Reader source={scripted({ 'README.md': README, 'notes.txt': 'plain\ntext' }).source} />,
    );
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(await screen.findByText('notes.txt'));
    const head = await screen.findByRole('region', { name: 'File' });
    await waitFor(() =>
      expect(within(head).getByRole('button', { name: 'Wrap lines' })).toBeTruthy(),
    );
    expect(within(head).getByRole('button', { name: 'Copy' })).toBeTruthy();
    // Context controls get their own toolbar line beneath the file details.
    const bar = within(head).getByRole('toolbar', { name: 'File tools' });
    expect(bar.contains(within(head).getByRole('button', { name: 'Wrap lines' }))).toBe(true);
    expect(bar.contains(within(head).getByLabelText('Path'))).toBe(false);
    expect(document.querySelector('main .leaf-code-file-bar')).toBeNull();
    expect(document.querySelector('main [data-viewer="code"]')).toBeTruthy();
  });
  it('a diagram or image file opens in the pan, zoom, and draw view, inline, with its tools in the toolbar line', async () => {
    render(
      <Reader
        source={
          scripted({
            'README.md': README,
            'pic.png': { mime: 'image/png', base64: 'iVBORw0KGgo=' },
          }).source
        }
      />,
    );
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(await screen.findByText('pic.png'));
    const head = await screen.findByRole('region', { name: 'File' });
    const main = document.querySelector('main')!;
    await waitFor(() => expect(within(main).getByTestId('stage-viewport')).toBeTruthy());
    const bar = within(head).getByRole('toolbar', { name: 'File tools' });
    expect(within(bar).getByRole('toolbar', { name: 'Stage tools' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Hand' })).toBeTruthy();
    // Not a pop-up.
    expect(screen.queryByRole('dialog', { name: 'Zoomed view' })).toBeNull();
  });

  it('blocks inside a markdown document keep their own hover tools', async () => {
    const md = '# T\n\n```js\nconst a = 1\n```\n';
    render(<Reader source={scripted({ 'README.md': md }).source} />);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() =>
      expect(document.querySelector('main .leaf-codeblock .leaf-block-tools')).toBeTruthy(),
    );
    expect(
      within(screen.getByRole('region', { name: 'File' })).queryByRole('button', {
        name: 'Zoom in',
      }),
    ).toBeNull();
  });
  it('code blocks are labeled with their language only when the fence names one', async () => {
    const md = '# T\n\n```js\nconst a = 1\n```\n\n```\nplain\n```\n';
    render(<Reader source={scripted({ 'README.md': md }).source} />);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(document.querySelectorAll('main .leaf-codeblock')).toHaveLength(2));
    const labels = [...document.querySelectorAll('main .leaf-codeblock .leaf-block-lang')];
    expect(labels.map((l) => l.textContent)).toEqual(['js']);
  });

  it('non-markdown files hide the outline without changing the saved setting', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('navigation', { name: 'Outline' })).toBeTruthy();
    fireEvent.click(screen.getByText('notes.txt'));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Outline' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Toggle outline' })).toBeNull();
    expect(
      JSON.parse(localStorage.getItem('leaf.ui') ?? '{"state":{}}').state.outlineOpen,
    ).not.toBe(false);
    fireEvent.click(screen.getByText('README.md'));
    expect(await screen.findByRole('navigation', { name: 'Outline' })).toBeTruthy();
  });

  it('a deep link into an open window shows its document there', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    expect(runCommand('openPath', { path: 'docs/guide.md' })).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
    expect(location.pathname).toBe('/docs/guide.md');
  });

  it('opening a file checks that the server is still there', async () => {
    const { source } = dir();
    const check = vi.fn();
    render(<Reader source={Object.assign(source, { check })} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    check.mockClear();
    fireEvent.click(screen.getByText('notes.txt'));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('back and forward beside the logo step through the files viewed', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { name: 'Title', level: 1 });
    const back = screen.getByRole('button', { name: /^Back/ }) as HTMLButtonElement;
    const forward = screen.getByRole('button', { name: /^Forward/ }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);
    fireEvent.click(screen.getByText('notes.txt'));
    await waitFor(() => expect(back.disabled).toBe(false));
    fireEvent.click(back);
    expect(await screen.findByRole('heading', { name: 'Title', level: 1 })).toBeTruthy();
    await waitFor(() => expect(forward.disabled).toBe(false));
    expect(back.disabled).toBe(true);
    fireEvent.click(forward);
    await waitFor(() => expect(location.pathname).toBe('/notes.txt'));
  });

  describe('blame', () => {
    const git = { commit: 'c'.repeat(40), author: 'Rob', date: 1, message: 'm' };
    const old = {
      commit: 'a'.repeat(40),
      author: 'Ann',
      date: Date.now() - 400 * 86_400_000,
      summary: 'start',
    };
    const fresh = {
      commit: 'b'.repeat(40),
      author: 'Bo',
      date: Date.now() - 2 * 86_400_000,
      summary: 'setup (#42)',
    };
    const blamed = () =>
      scripted(
        {
          'README.md': README,
          'notes.txt': 'one\ntwo\nthree\n',
          'flow.mmd': 'graph LR\nA-->B\n',
          'plain.md': '# Plain\n',
        },
        {
          git: { 'README.md': git, 'notes.txt': git, 'flow.mmd': git },
          blame: {
            'README.md': [
              { start: 1, lines: 4, ...old },
              { start: 5, lines: 12, ...fresh },
            ],
            'notes.txt': [
              { start: 1, lines: 2, ...old },
              { start: 3, lines: 1, ...fresh },
            ],
          },
        },
      ).source;
    beforeEach(() => useUi.setState({ blame: false, blameWidth: 220 }));

    it('the header offers blame for markdown and code in git, not for diagrams or files outside git', async () => {
      render(<Reader source={blamed()} />);
      await screen.findByRole('heading', { name: 'Title', level: 1 });
      const head = () => screen.getByRole('region', { name: 'File' });
      expect(within(head()).getByRole('button', { name: 'Blame' })).toBeTruthy();
      fireEvent.click(screen.getByText('flow.mmd'));
      await waitFor(() =>
        expect(within(head()).getByLabelText('Path').textContent).toBe('flow.mmd'),
      );
      expect(within(head()).queryByRole('button', { name: 'Blame' })).toBeNull();
      fireEvent.click(screen.getByText('plain.md'));
      await screen.findByRole('heading', { name: 'Plain', level: 1 });
      expect(within(head()).queryByRole('button', { name: 'Blame' })).toBeNull();
    });

    it('markdown: every block annotated with commit, author, age, and the commit message', async () => {
      render(<Reader source={blamed()} />);
      await screen.findByRole('heading', { name: 'Title', level: 1 });
      const head = screen.getByRole('region', { name: 'File' });
      expect(document.querySelector('.leaf-blame-block')).toBeNull();
      fireEvent.click(within(head).getByRole('button', { name: 'Blame' }));
      await waitFor(() =>
        expect(document.querySelectorAll('.leaf-blame-block').length).toBeGreaterThan(1),
      );
      const blocks = [...document.querySelectorAll<HTMLElement>('.leaf-blame-block')];
      // The title (line 1) is the old commit; a later block is the fresh one.
      expect(blocks[0]!.querySelector('.leaf-blame-label')!.textContent).toMatch(/^aaaaaaa Ann /);
      expect(blocks[0]!.querySelector('.leaf-blame-summary')!.textContent).toBe('start');
      // The commit and its pull request link out; the PR number leaves the message line.
      const sha = blocks[0]!.querySelector<HTMLAnchorElement>('a.leaf-blame-sha')!;
      expect(sha.textContent).toBe('aaaaaaa');
      expect(sha.href).toBe(`https://github.com/rob/leaf/commit/${'a'.repeat(40)}`);
      const fresh = blocks.find(
        (b) => b.querySelector('.leaf-blame-summary')?.textContent === 'setup',
      )!;
      expect(fresh).toBeTruthy();
      const pr = fresh.querySelector<HTMLAnchorElement>('a.leaf-blame-pr')!;
      expect(pr.textContent).toBe('#42');
      expect(pr.href).toBe('https://github.com/rob/leaf/pull/42');
      expect(blocks[0]!.querySelector('a.leaf-blame-pr')).toBeNull();
      // One mode: no separate details control.
      expect(within(head).queryByRole('button', { name: 'Blame details' })).toBeNull();
      fireEvent.click(within(head).getByRole('button', { name: 'Blame' }));
      expect(document.querySelector('.leaf-blame-block')).toBeNull();
    });

    it('a fenced code block, wrapped in its frame, is annotated like any block', async () => {
      useUi.setState({ blame: true });
      const md = '# T\n\n```js\nconst a = 1\n```\n\nAfter.\n';
      const source = scripted(
        { 'README.md': md },
        {
          git: { 'README.md': git },
          blame: {
            'README.md': [
              { start: 1, lines: 2, ...old },
              { start: 3, lines: 3, ...fresh },
              { start: 6, lines: 2, ...old },
            ],
          },
        },
      ).source;
      render(<Reader source={source} />);
      await screen.findByRole('heading', { name: 'T', level: 1 });
      await waitFor(() => expect(document.querySelectorAll('.leaf-blame-block')).toHaveLength(3));
      const labels = [...document.querySelectorAll('.leaf-blame-block .leaf-blame-label')].map(
        (l) => l.textContent!.slice(0, 11),
      );
      expect(labels).toEqual(['aaaaaaa Ann', 'bbbbbbb Bo ', 'aaaaaaa Ann']);
    });

    it('blame shows however narrow the window: the button decides, not the width', async () => {
      useUi.setState({ blame: true });
      const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
      // Measured at once, as a real window would be.
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private cb: () => void) {}
          observe() {
            this.cb();
          }
          disconnect() {}
        },
      );
      try {
        render(<Reader source={blamed()} />);
        await screen.findByRole('heading', { name: 'Title', level: 1 });
        await waitFor(() =>
          expect(document.querySelectorAll('.leaf-blame-block').length).toBeGreaterThan(0),
        );
      } finally {
        width.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it('the annotation column can be dragged wider or narrower, down to a minimum', async () => {
      useUi.setState({ blame: true, blameWidth: 220 });
      render(<Reader source={blamed()} />);
      await screen.findByRole('heading', { name: 'Title', level: 1 });
      const handle = await screen.findByRole('separator', { name: 'Resize blame' });
      expect(handle.getAttribute('aria-valuenow')).toBe('220');
      fireEvent.keyDown(handle, { key: 'ArrowRight' });
      expect(useUi.getState().blameWidth).toBe(236);
      for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      expect(useUi.getState().blameWidth).toBe(160);
      expect(JSON.parse(localStorage.getItem('leaf.ui')!).state.blameWidth).toBe(160);
    });

    it('code files: blame in the editor gutter', async () => {
      useUi.setState({ blame: true });
      render(<Reader source={blamed()} />);
      await screen.findByRole('heading', { name: 'Title', level: 1 });
      fireEvent.click(screen.getByText('notes.txt'));
      await waitFor(() =>
        expect(
          document.querySelectorAll('.cm-blame-gutter .leaf-blame-cell').length,
        ).toBeGreaterThan(0),
      );
      const cells = [
        ...document.querySelectorAll<HTMLElement>('.cm-blame-gutter .leaf-blame-cell'),
      ];
      expect(cells.some((c) => c.title.includes('aaaaaaa Ann'))).toBe(true);
      expect(cells.some((c) => c.title.includes('bbbbbbb Bo'))).toBe(true);
      // Annotated from the start: the label on each block's first line, its message under it.
      await waitFor(() =>
        expect(document.querySelector('.cm-blame-gutter .leaf-blame-label')?.textContent).toMatch(
          /^aaaaaaa Ann /,
        ),
      );
      expect(document.querySelector('.cm-blame-gutter .leaf-blame-summary')?.textContent).toBe(
        'start',
      );
    });
  });

  it('⌘, opens Settings, and so does the appearance menu', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance and settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings…' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });

  it('a link the app refused says so, with a way to Settings', async () => {
    render(<Reader source={dir().source} />);
    await screen.findByRole('heading', { level: 1 });
    act(() => useNotice.getState().linkRefused('zed'));
    const note = screen.getByRole('status', { name: 'Notice' });
    expect(note.textContent).toMatch(/zed: links/);
    fireEvent.click(within(note).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Notice' })).toBeNull();
  });
});
